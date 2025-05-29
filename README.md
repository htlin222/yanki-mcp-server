# Yanki MCP Server

A Model Context Protocol server implementation that connects to a locally running Anki, providing card review and creation. This is a fork of [scorzeth/anki-mcp-server](https://github.com/scorzeth/anki-mcp-server) with date-based organization features.

Available as an npm package: [yanki-mcp-server](https://www.npmjs.com/package/yanki-mcp-server)

This server is designed to work with the [Anki desktop app](https://apps.ankiweb.net/) and the [Anki-Connect](https://foosoft.net/projects/anki-connect/) add-on.

Make sure you have the add-on installed before using.

## Resources
- **anki://search/deckcurrent**
  - Returns all cards from current deck
  - Equivalent of `deck:current` in Anki
- **anki://search/isdue**
  - Returns cards in review and learning waiting to be studied
  - Equivalent of `is:due` in Anki
- **anki://search/isnew**
  - Returns all unseen cards 
  - Equivalent of `is:new` in Anki

## Tools
- **update_cards**
  - Marks cards with given card IDs as answered and gives them an ease score between 1 (Again) and 4 (Easy)
  - Inputs:
    - `answers` (array): Array of objects with `cardId` (number) and `ease` (number) fields

- **add_card**
  - Creates a new card in a date-structured deck (format: `DECK::YYYY::MM::DD`)
  - Inputs:
    - `front` (string): Front of card
    - `back` (string): Back of card

- **get_due_cards**
  - Returns n number of cards currently due for review
  - Inputs:
    - `num` (number): Number of cards

- **get_new_cards**
  - Returns n number of cards from new
  - Inputs:
    - `num` (number): Number of cards

## Installation & Usage

You can use this package without installation via npx:

```bash
npx yanki-mcp-server
```

Or install it globally:

```bash
npm install -g yanki-mcp-server
yanki-server
```

## Development

Clone the repository and install dependencies:

```bash
git clone https://github.com/htlin222/yanki-mcp-server.git
cd yanki-mcp-server
npm install
```

Build the server:
```bash
npm run build
```

For development with auto-rebuild:
```bash
npm run watch
```

Run the server directly during development:
```bash
npm run dev
```

## Configuration 

To use with Claude Desktop, add the server config:

On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "yanki-mcp-server": {
      "command": "npx",
      "args": ["yanki-mcp-server"],
      "env": {
        "DECK": "Default"
      }
    }
  }
}
```

### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. We recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), which is available as a package script:

```bash
npm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.

## Date-Based Card Organization

This server automatically organizes new cards using a date-based structure instead of traditional topic-based organization. When you create a new card, it's added to a deck with the following format:

```
DECK::YYYY::MM::DD
```

Where:
- `DECK` is the base deck name (default: "00_Inbox" or configured via environment variable)
- `YYYY` is the 4-digit year
- `MM` is the 2-digit month
- `DD` is the 2-digit day

### Benefits of Date-Based Organization

1. **Effortless Organization**: Cards are automatically organized by creation date without manual categorization
2. **Temporal Context**: Review cards created during specific time periods (e.g., during a course or project)
3. **Natural Spaced Repetition**: Cards naturally group by when you learned concepts
4. **Time-Efficient**: No need to spend time deciding which category each card belongs to
5. **Historical Record**: See your learning journey over time

### Configuration

You can customize the base deck name by setting the `DECK` environment variable in your MCP server configuration:

```json
"env": {
  "DECK": "YourCustomDeckName"
}
```

If not specified, it defaults to "00_Inbox".
