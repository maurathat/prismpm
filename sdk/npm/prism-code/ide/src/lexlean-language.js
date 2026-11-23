// LexLean as a language of the editor: a name, the file ending it goes with, brackets, and a tokenizer for colour.
//
// The tokenizer is written from the models in this repository (model/, test/fixtures/starters/), not from LexLean's
// grammar: it colours what those files contain. It decides nothing. What a model means is LexLean's to say, in the
// worker; a wrong colour here changes no verdict.

export const LEXLEAN = 'lexlean';
// The tokenizer is registered under a name of its own, which no file has. The workbench cannot run a tokenizer of
// this kind on an open file (it has no colour table of the kind that tokenizer writes into, and logs an error for
// every line), so the tokenizer is only ever asked for a text's tokens, and those reach the file as semantic tokens.
const TOKENS = 'lexlean-tokens';

// The declarations a semantic module is made of, and the members they carry.
const DECLARATIONS = ['structure', 'definition', 'theorem', 'inductive', 'axiom', 'lexeme'];
const MEMBERS = ['name', 'type_parameters', 'parameters', 'fields', 'result', 'body', 'statement', 'proof', 'axioms', 'definitions',
  'recursive_argument', 'type', 'constructors', 'cases', 'using'];
// Words of the expression notation.
const KEYWORDS = ['if', 'then', 'else', 'match', 'let', 'record', 'project', 'cons', 'nil', 'ctor', 'prim', 'not', 'fun', 'forall', 'exists', 'true', 'false'];
const TYPES = ['Nat', 'Bool', 'String', 'Bytes', 'List', 'Option', 'UInt8', 'UInt32', 'UInt64', 'Int', 'Prop', 'Unit'];
const PROOFS = ['linear_arithmetic', 'decide', 'reflexivity', 'induction', 'cases', 'simplify', 'rewrite', 'calculate'];

export const configuration = {
  brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  autoClosingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }, { open: '"', close: '"', notIn: ['string'] }],
  surroundingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }, { open: '"', close: '"' }],
  comments: { lineComment: '%' },
};

export const tokens = {
  defaultToken: '',
  declarations: DECLARATIONS, members: MEMBERS, keywords: KEYWORDS, types: TYPES, proofs: PROOFS,
  tokenizer: {
    root: [
      // The document's frame: \begin{lexlean}{App}, \useglossary{...}, \importmodule{...}, \title{...}, \end{...}.
      [/\\(?:begin|end)\b/, 'keyword.control', '@environment'],
      [/\\[A-Za-z]+/, 'keyword.control', '@argument'],
      [/%.*$/, 'comment'],
      [/"/, 'string', '@string'],
      [/0x[0-9a-fA-F]*/, 'number.hex'],
      [/\d+/, 'number'],
      // A member of a declaration: `name:` and its kin, at the start of a line or after `{` or `,`.
      [/([a-z_]+)(\s*)(:)(?![:=])/, { cases: { '$1@members': ['attribute.name', '', 'delimiter'], '@default': ['variable', '', 'delimiter'] } }],
      // A name from another module: Module::name.
      [/([A-Z][A-Za-z0-9_.]*)(::)([A-Za-z_][A-Za-z0-9_]*)/, ['namespace', 'delimiter', 'identifier']],
      [/[A-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+/, 'type.identifier'],
      [/[A-Za-z_][A-Za-z0-9_]*/, { cases: { '@declarations': 'keyword', '@keywords': 'keyword', '@proofs': 'keyword.other', '@types': 'type', '@default': 'identifier' } }],
      [/:=|<=\?|>=\?|<\?|>\?|=\?|&&|\|\||=>|→|↔|∧|∨|¬|[=+\-*|]/, 'operator'],
      [/[{}()[\]]/, '@brackets'],
      [/[,;:]/, 'delimiter'],
    ],
    // \begin{lexlean}{App}: the environment's name, then its arguments.
    environment: [[/\{/, 'delimiter.curly', '@braced'], [/(?=[^{])/, '', '@pop'], [/$/, '', '@pop']],
    argument: [[/\{/, 'delimiter.curly', '@braced'], [/(?=[^{])/, '', '@pop'], [/$/, '', '@pop']],
    braced: [[/[^{}]+/, 'string'], [/\}/, 'delimiter.curly', '@pop']],
    string: [[/[^"\\]+/, 'string'], [/\\./, 'string.escape'], [/"/, 'string', '@pop']],
  },
};

// The workbench's themes do not colour a tokenizer's own token names; they colour semantic tokens. So the tokens
// above are handed over as semantic tokens of the standard kinds, which every theme knows.
const KINDS = ['keyword', 'type', 'string', 'number', 'operator', 'property', 'namespace', 'comment'];
const kindOf = (type) => (type.startsWith('keyword') ? 0 : type.startsWith('type') ? 1 : type.startsWith('string') ? 2 : type.startsWith('number') ? 3
  : type.startsWith('operator') ? 4 : type.startsWith('attribute') ? 5 : type.startsWith('namespace') ? 6 : type.startsWith('comment') ? 7 : -1);

/** The semantic tokens of a text: [line delta, start delta, length, kind, 0] for each coloured token, as the editor wants them. */
export function semanticTokens(monaco, text) {
  const data = [];
  const lines = text.split('\n');
  let lastLine = 0, lastStart = 0;
  for (const [line, found] of monaco.editor.tokenize(text, TOKENS).entries()) {
    for (const [i, token] of found.entries()) {
      const kind = kindOf(token.type);
      const end = i + 1 < found.length ? found[i + 1].offset : lines[line].replace(/\r$/, '').length;
      if (kind < 0 || end <= token.offset) continue;
      data.push(line - lastLine, line === lastLine ? token.offset - lastStart : token.offset, end - token.offset, kind, 0);
      lastLine = line;
      lastStart = token.offset;
    }
  }
  return new Uint32Array(data);
}

/** The kinds of token in a text, line by line, for a test to read. */
export const tokenTypes = (monaco, text) => monaco.editor.tokenize(text, TOKENS).map((line) => line.map((token) => token.type));

/** Make the editor know LexLean. Call once, before a model of that file ending is opened. */
export function registerLexLean(monaco) {
  registerLexLean.calls = 0; // how often the editor asked for colours, for a test to read
  monaco.languages.register({ id: LEXLEAN, aliases: ['LexLean'], extensions: ['.lex.tex'] });
  monaco.languages.setLanguageConfiguration(LEXLEAN, configuration);
  monaco.languages.register({ id: TOKENS });
  monaco.languages.setMonarchTokensProvider(TOKENS, tokens);
  monaco.languages.registerDocumentSemanticTokensProvider(LEXLEAN, {
    getLegend: () => ({ tokenTypes: KINDS, tokenModifiers: [] }),
    provideDocumentSemanticTokens: (model) => { registerLexLean.calls++; return { data: semanticTokens(monaco, model.getValue()) }; },
    releaseDocumentSemanticTokens: () => {},
  });
}
