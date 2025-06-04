#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { YankiConnect } from "yanki-connect";

/**
 * Safely parse a JSON string without throwing exceptions
 * @param text The text to parse as JSON
 * @returns The parsed JSON object or undefined if parsing failed
 */
function safeParseJSON(text: string): any | undefined {
  try {
    return JSON.parse(text);
  } catch (err) {
    // Not valid JSON, return undefined
    return undefined;
  }
}

// Configure YankiConnect with safe JSON parsing
const client = new YankiConnect();

// Default inbox prefix if environment variable is not set
const DECK = "00_Inbox";
// Get inbox prefix from environment variable or use default
const PREFIX_DECK = process.env.ANKI_DECK || DECK;

interface Card {
  cardId: number;
  question: string;
  answer: string;
  due: number;
}

/**
 * Create an MCP server with capabilities for resources (to get Anki cards),
 * and tools (to answer cards, create new cards and get cards).
 */
const server = new Server(
  {
    name: "anki-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

/**
 * Handler for listing Anki cards as resources.
 * Cards are exposed as a resource with:
 * - An anki:// URI scheme plus a filter
 * - JSON MIME type
 * - All resources return a list of cards under different filters
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "anki://search/deckcurrent",
        mimeType: "application/json",
        name: "Current Deck",
        description: "Current Anki deck",
      },
      {
        uri: "anki://search/isdue",
        mimeType: "application/json",
        name: "Due cards",
        description: "Cards in review and learning waiting to be studied",
      },
      {
        uri: "anki://search/isnew",
        mimiType: "application/json",
        name: "New cards",
        description: "All unseen cards",
      },
    ],
  };
});

/**
 * Filters Anki cards based on selected resource
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const url = new URL(request.params.uri);
  const query = url.pathname.split("/").pop();
  if (!query) {
    throw new Error("Invalid resource URI");
  }

  const cards = await findCardsAndOrder(query);

  return {
    contents: [
      {
        uri: request.params.uri,
        mimeType: "application/json",
        text: JSON.stringify(cards),
      },
    ],
  };
});

// Returns a list of cards ordered by due date
async function findCardsAndOrder(query: string): Promise<Card[]> {
  const cardIds = await client.card.findCards({
    query: formatQuery(query),
  });
  const cards: Card[] = (await client.card.cardsInfo({ cards: cardIds }))
    .map((card) => ({
      cardId: card.cardId,
      question: cleanWithRegex(card.question),
      answer: cleanWithRegex(card.answer),
      due: card.due,
    }))
    .sort((a: Card, b: Card) => a.due - b.due);

  return cards;
}

// Formats the uri to be a proper query
function formatQuery(query: string): string {
  if (query.startsWith("deck")) {
    return `deck:${query.slice(4)}`;
  }
  if (query.startsWith("is")) {
    return `is:${query.slice(2)}`;
  }
  return query;
}

function getTodayDeckName(): string {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `${PREFIX_DECK}::${yyyy}::${mm}::${dd}`;
}

/**
 * Creates a deck if it doesn't already exist, robustly handling non-JSON responses and AnkiConnect errors.
 * Also clones the default deck config and assigns it to the new deck.
 * @param deckName The name of the deck to create
 * @returns Promise resolving to true if deck was created or already exists
 */
async function createDeckIfNeeded(deckName: string): Promise<boolean> {
  try {
    const deckNames = await client.deck.deckNames();
    if (deckNames && Array.isArray(deckNames) && deckNames.includes(deckName)) {
      return true;
    }

    try {
      await client.deck.createDeck({ deck: deckName });

      // Clone the default config and assign it to the new deck
      const defaultConfigId = 1; // usually 1 is the default config in Anki
      const clonedConfigId = await client.deck.cloneDeckConfigId({
        name: `${deckName}::config`,
        cloneFrom: defaultConfigId,
      });

      await client.deck.setDeckConfigId({
        decks: [deckName],
        configId: clonedConfigId,
      });
    } catch (e: any) {
      const message = typeof e === "string" ? e : e?.message;
      if (typeof message === "string" && message.includes("already exists")) {
        // Deck already exists, treat as success
      } else {
        throw e;
      }
    }

    // Confirm again whether the deck exists after attempting to create it
    const updatedDeckNames = await client.deck.deckNames();
    return (
      Array.isArray(updatedDeckNames) && updatedDeckNames.includes(deckName)
    );
  } catch (error) {
    try {
      const fallbackDeckNames = await client.deck.deckNames();
      return (
        Array.isArray(fallbackDeckNames) && fallbackDeckNames.includes(deckName)
      );
    } catch {
      return false;
    }
  }
}

// Strip away formatting that isn't necessary
function cleanWithRegex(htmlString: string): string {
  return (
    htmlString
      // Remove style tags and their content
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      // Replace divs with newlines
      .replace(/<div[^>]*>/g, "\n")
      // Remove all HTML tags
      .replace(/<[^>]+>/g, " ")
      // Remove anki play tags
      .replace(/\[anki:play:[^\]]+\]/g, "")
      // Convert HTML entities
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      // Clean up whitespace but preserve newlines
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n")
  );
}

/**
 * Handler that lists available tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "update_cards",
        description:
          "After the user answers cards you've quizzed them on, use this tool to mark them answered and update their ease",
        inputSchema: {
          type: "object",
          properties: {
            answers: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  cardId: {
                    type: "number",
                    description: "Id of the card to answer",
                  },
                  ease: {
                    type: "number",
                    description:
                      "Ease of the card between 1 (Again) and 4 (Easy)",
                  },
                },
              },
            },
          },
        },
      },
      {
        name: "add_card",
        description:
          'Create a new flashcard in Anki for the user. Must use HTML formatting only. IMPORTANT FORMATTING RULES:\n1. Must use HTML tags for ALL formatting - NO markdown\n2. Use <br> for ALL line breaks\n3. For code blocks, use <pre> with inline CSS styling\n4. Example formatting:\n   - Line breaks: <br>\n   - Code: <pre style="background-color: transparent; padding: 10px; border-radius: 5px;">\n   - Title: <h2> to <h6> tags\n   - Lists: <ol> and <li> tags\n   - Bold: <strong>\n   - Italic: <em>',
        inputSchema: {
          type: "object",
          properties: {
            front: {
              type: "string",
              description:
                "The front of the card. Must use HTML formatting only.",
            },
            back: {
              type: "string",
              description:
                "The back of the card. Must use HTML formatting only.",
            },
          },
          required: ["front", "back"],
        },
      },
      {
        name: "get_due_cards",
        description: "Returns a given number (num) of cards due for review.",
        inputSchema: {
          type: "object",
          properties: {
            num: {
              type: "number",
              description: "Number of due cards to get",
            },
          },
          required: ["num"],
        },
      },
      {
        name: "get_new_cards",
        description: "Returns a given number (num) of new and unseen cards.",
        inputSchema: {
          type: "object",
          properties: {
            num: {
              type: "number",
              description: "Number of new cards to get",
            },
          },
          required: ["num"],
        },
      },
    ],
  };
});

/**
 * Handler for the update_cards, add_card, get_due_cards and get_new_cards tools.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args) {
    throw new Error(`No arguments provided for tool: ${name}`);
  }

  switch (name) {
    case "update_cards": {
      const answers = args.answers as { cardId: number; ease: number }[];
      const result = await client.card.answerCards({ answers: answers });

      const successfulCards = answers
        .filter((_, index) => result[index])
        .map((card) => card.cardId);
      const failedCards = answers.filter((_, index) => !result[index]);

      if (failedCards.length > 0) {
        const failedCardIds = failedCards.map((card) => card.cardId);
        throw new Error(
          `Failed to update cards with IDs: ${failedCardIds.join(", ")}`
        );
      }

      return {
        content: [
          {
            type: "text",
            text: `Updated cards ${successfulCards.join(", ")}`,
          },
        ],
      };
    }

    case "add_card": {
      const front = String(args.front);
      const back = String(args.back);
      const deckName = getTodayDeckName();

      // Create the deck if it doesn't exist
      const deckCreated = await createDeckIfNeeded(deckName);
      if (!deckCreated) {
        throw new Error(`Failed to create deck: ${deckName}`);
      }

      const note = {
        note: {
          deckName: deckName,
          fields: {
            Back: back,
            Front: front,
          },
          modelName: "Basic",
        },
      };

      const noteId = await client.note.addNote(note);
      if (!noteId) {
        throw new Error("Failed to add note to Anki");
      }

      const cardIds = await client.card.findCards({ query: `nid:${noteId}` });
      const cardId = cardIds[0];

      return {
        content: [
          {
            type: "text",
            text: `Created card with id ${cardId} in deck ${deckName}`,
          },
        ],
      };
    }

    case "get_due_cards": {
      const num = Number(args.num);

      const cards = await findCardsAndOrder("is:due");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(cards.slice(0, num)),
          },
        ],
      };
    }

    case "get_new_cards": {
      const num = Number(args.num);

      const cards = await findCardsAndOrder("is:new");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(cards.slice(0, num)),
          },
        ],
      };
    }

    default:
      throw new Error("Unknown tool");
  }
});

/**
 * Patch the global JSON.parse to be more robust
 * This is a last-resort approach to handle non-JSON responses from Anki
 * that are breaking the MCP protocol
 */
function patchGlobalJsonParse(): void {
  // Store the original JSON.parse function
  const originalJsonParse = JSON.parse;

  // Override JSON.parse with a more robust version
  JSON.parse = function safeJsonParse(text: string, ...args: any[]): any {
    try {
      // First try the original parse
      return originalJsonParse.call(JSON, text, ...args);
    } catch (err) {
      // If it's a string, attempt to wrap in JSON format
      if (typeof text === "string") {
        const safeText = text
          .trim()
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"');
        return { message: safeText };
      }
      // Otherwise, re-throw the error
      throw err;
    }
  };
}

// Intercept process.stdout.write to suppress non-JSON output
const originalStdoutWrite = process.stdout.write.bind(process.stdout);

process.stdout.write = function (
  chunk: any,
  encoding?: any,
  callback?: any
): boolean {
  try {
    const str = typeof chunk === "string" ? chunk : chunk.toString();
    if (str.trim().startsWith('{"jsonrpc"')) {
      return originalStdoutWrite(chunk, encoding, callback);
    }
    return true; // silently drop
  } catch {
    return true;
  }
};

/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
async function main() {
  // Create a wrapper for all client methods to handle JSON parsing errors
  // This makes all API calls robust against non-JSON responses
  const wrapMethod = (obj: any, methodName: string) => {
    if (obj && typeof obj[methodName] === "function") {
      const original = obj[methodName];
      obj[methodName] = async function (...args: any[]) {
        try {
          return await original.apply(this, args);
        } catch (err) {
          // Removed console.warn to prevent non-JSON output
          if (err instanceof SyntaxError && err.message.includes("JSON")) {
            // Return a safe default for JSON parsing errors
            return null;
          }
          throw err; // Re-throw other errors
        }
      };
    }
  };

  // Apply the wrapper to common API methods that might receive non-JSON responses
  if (client.deck) wrapMethod(client.deck, "deckNames");
  if (client.deck) wrapMethod(client.deck, "createDeck");
  if (client.note) wrapMethod(client.note, "addNote");
  if (client.card) wrapMethod(client.card, "findCards");
  if (client.card) wrapMethod(client.card, "cardsInfo");
  if (client.card) wrapMethod(client.card, "answerCards");

  // Connect to Anki silently
  try {
    await client.deck.deckNames();
  } catch (error: unknown) {
    // Silent fail - we don't want to break the MCP protocol
  }

  // Apply our global JSON.parse patch to handle non-JSON responses
  patchGlobalJsonParse();

  // Use the standard transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.exit(1);
});
