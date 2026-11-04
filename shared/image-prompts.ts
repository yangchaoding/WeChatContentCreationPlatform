import { defaultCoverStyle } from './images';

export interface CoverPrompt { id: string; name: string; content: string }
export interface CoverPromptLibrary { prompts: CoverPrompt[]; selectedId: string }

export const MAX_COVER_PROMPTS = 50;
export const MAX_PROMPT_NAME = 60;
export const MAX_PROMPT_CONTENT = 2000;

export function defaultCoverPrompts(): CoverPromptLibrary {
  return { selectedId: 'default', prompts: [{ id: 'default', name: '简洁编辑插画', content: defaultCoverStyle }] };
}
