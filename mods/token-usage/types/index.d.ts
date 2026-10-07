export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** One finished main-loop turn: its final answer text and what it cost. */
export type TurnRecord = { answer: string; usage: Usage }

declare module 'claude-code' {
  interface PluginState {
    'token-usage': { turns: TurnRecord[] }
  }
}
