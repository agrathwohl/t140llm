import { BACKSPACE } from './constants';

/**
 * Result of processing T.140 backspace characters
 */
export interface T140BackspaceResult {
  processedText: string;
  updatedBuffer: string;
}

/**
 * Process text to handle T.140 backspace characters
 * @param text The input text that may contain backspace characters
 * @param textBuffer Optional existing text buffer to apply backspaces to
 * @returns Object containing the processed text ready for sending and updated buffer state
 */
export function processT140BackspaceChars(
  text: string,
  textBuffer: string = ''
): T140BackspaceResult {
  if (!text.includes(BACKSPACE) && textBuffer === '') {
    // Fast path: if there are no backspaces and no buffer, just return the text as is
    return { processedText: text, updatedBuffer: '' };
  }

  let processedText = '';
  let updatedBuffer = textBuffer;
  let currentPos = 0;

  // Process each character in the input text
  while (currentPos < text.length) {
    const char = text[currentPos];

    if (char === BACKSPACE) {
      // Handle backspace by removing the last character from the buffer
      if (updatedBuffer.length > 0) {
        // Remove the last character from the buffer
        updatedBuffer = updatedBuffer.slice(0, -1);
        // Add backspace to the processed text to be sent
        processedText += BACKSPACE;
      }
    } else {
      // Add normal character to both buffer and processed text
      updatedBuffer += char;
      processedText += char;
    }
    currentPos += 1;
  }

  return { processedText, updatedBuffer };
}
