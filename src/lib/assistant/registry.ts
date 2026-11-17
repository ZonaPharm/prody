/**
 * All the assistant's tools in one list: the read-only ones (tools.ts), then
 * the ones that prepare proposals and files (actions.ts).
 */
import { ACTION_TOOLS } from './actions'
import { READ_TOOLS, definitionsOf, runToolIn, statusIn, type ToolContext } from './tools'

export const ASSISTANT_TOOLS = [...READ_TOOLS, ...ACTION_TOOLS]

export function toolDefinitions() {
  return definitionsOf(ASSISTANT_TOOLS)
}

export function runTool(ctx: ToolContext, name: string, input: unknown) {
  return runToolIn(ASSISTANT_TOOLS, ctx, name, input)
}

export function toolStatus(name: string) {
  return statusIn(ASSISTANT_TOOLS, name)
}
