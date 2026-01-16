import { BACKSPACE } from './constants';

/**
 * Result of processing T.140 backspace characters
 */
export interface T140BackspaceResult {
  processedText: string;
  updatedBuffer: string;
}

/**
 * Grapheme segmenter for proper Unicode handling per T.140 spec
 * Uses Intl.Segmenter to correctly handle:
 * - Emoji (including ZWJ sequences like family emoji)
 * - Combining characters (like café with combining acute)
 * - Other complex grapheme clusters
 */
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * Split a string into grapheme clusters (user-perceived characters)
 * Useful for text processing that needs to respect Unicode boundaries
 *
 * @param str The string to split
 * @returns Array of grapheme clusters
 * @example
 * toGraphemes('👨‍👩‍👧') // ['👨‍👩‍👧'] - family emoji stays together
 * toGraphemes('café')    // ['c', 'a', 'f', 'é'] - combining accent handled
 */
export function toGraphemes(str: string): string[] {
  return Array.from(segmenter.segment(str), ({ segment }) => segment);
}

/**
 * Process text to handle T.140 backspace characters
 * Properly handles Unicode grapheme clusters per ITU-T T.140 / RFC 4103
 *
 * @param text The input text that may contain backspace characters
 * @param textBuffer Optional existing text buffer to apply backspaces to
 * @returns Object containing the processed text ready for sending and updated buffer state
 */
export function processT140BackspaceChars(
  text: string,
  textBuffer: string = ''
): T140BackspaceResult {
  if (!text.includes(BACKSPACE) && textBuffer === '') {
    // Fast path: no backspaces and no existing buffer - text becomes the new buffer
    return { processedText: text, updatedBuffer: text };
  }

  let processedText = '';
  // Convert buffer to grapheme array for proper Unicode handling
  const bufferGraphemes = toGraphemes(textBuffer);

  // Process input by grapheme clusters
  const inputGraphemes = toGraphemes(text);

  for (const grapheme of inputGraphemes) {
    if (grapheme === BACKSPACE) {
      // Handle backspace by removing the last grapheme cluster from the buffer
      if (bufferGraphemes.length > 0) {
        bufferGraphemes.pop();
        // Add backspace to the processed text to be sent
        processedText += BACKSPACE;
      }
    } else {
      // Add normal grapheme to both buffer and processed text
      bufferGraphemes.push(grapheme);
      processedText += grapheme;
    }
  }

  return { processedText, updatedBuffer: bufferGraphemes.join('') };
}
