// a file read as text by vite (the wrangler.toml var check in units.test.ts); a global declaration, so no import here
declare module '*?raw' {
  const text: string
  export default text
}
