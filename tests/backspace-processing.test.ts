import { processT140BackspaceChars, toGraphemes } from '../src/utils/backspace-processing';
import { BACKSPACE } from '../src/utils/constants';

describe('T140 Backspace Processing - Unicode Compliance', () => {

  describe('toGraphemes - Grapheme Cluster Segmentation', () => {

    describe('ASCII text', () => {
      test('splits ASCII text into individual characters', () => {
        expect(toGraphemes('hello')).toEqual(['h', 'e', 'l', 'l', 'o']);
      });

      test('handles empty string', () => {
        expect(toGraphemes('')).toEqual([]);
      });

      test('handles single character', () => {
        expect(toGraphemes('a')).toEqual(['a']);
      });

      test('handles whitespace', () => {
        expect(toGraphemes('a b')).toEqual(['a', ' ', 'b']);
      });

      test('handles newlines', () => {
        expect(toGraphemes('a\nb')).toEqual(['a', '\n', 'b']);
      });
    });

    describe('simple emoji', () => {
      test('treats single emoji as one grapheme', () => {
        expect(toGraphemes('👍')).toEqual(['👍']);
        expect(toGraphemes('👍').length).toBe(1);
      });

      test('treats each emoji as separate grapheme', () => {
        expect(toGraphemes('👍👎')).toEqual(['👍', '👎']);
        expect(toGraphemes('👍👎').length).toBe(2);
      });

      test('handles emoji mixed with ASCII', () => {
        expect(toGraphemes('hi👍bye')).toEqual(['h', 'i', '👍', 'b', 'y', 'e']);
      });

      test('handles various single emoji', () => {
        const emojis = ['😀', '🎉', '❤️', '🔥', '✨'];
        emojis.forEach(emoji => {
          expect(toGraphemes(emoji).length).toBe(1);
          expect(toGraphemes(emoji)[0]).toBe(emoji);
        });
      });
    });

    describe('ZWJ sequences (Zero Width Joiner)', () => {
      test('treats family emoji as single grapheme', () => {
        const family = '👨‍👩‍👧'; // Man + ZWJ + Woman + ZWJ + Girl
        expect(toGraphemes(family)).toEqual([family]);
        expect(toGraphemes(family).length).toBe(1);
      });

      test('treats family of four as single grapheme', () => {
        const family = '👨‍👩‍👧‍👦'; // Man + Woman + Girl + Boy
        expect(toGraphemes(family)).toEqual([family]);
        expect(toGraphemes(family).length).toBe(1);
      });

      test('treats couple with heart as single grapheme', () => {
        const couple = '👩‍❤️‍👨'; // Woman + Heart + Man
        expect(toGraphemes(couple)).toEqual([couple]);
        expect(toGraphemes(couple).length).toBe(1);
      });

      test('treats profession emoji as single grapheme', () => {
        const pilot = '👨‍✈️'; // Man + Airplane
        expect(toGraphemes(pilot)).toEqual([pilot]);
        expect(toGraphemes(pilot).length).toBe(1);
      });

      test('handles multiple ZWJ sequences', () => {
        const family1 = '👨‍👩‍👧';
        const family2 = '👨‍👩‍👦';
        const text = `${family1} ${family2}`;
        expect(toGraphemes(text)).toEqual([family1, ' ', family2]);
        expect(toGraphemes(text).length).toBe(3);
      });
    });

    describe('skin tone modifiers', () => {
      test('treats emoji with skin tone as single grapheme', () => {
        const wave = '👋🏽'; // Waving hand + medium skin tone
        expect(toGraphemes(wave)).toEqual([wave]);
        expect(toGraphemes(wave).length).toBe(1);
      });

      test('handles different skin tones', () => {
        const tones = ['👋🏻', '👋🏼', '👋🏽', '👋🏾', '👋🏿'];
        tones.forEach(emoji => {
          expect(toGraphemes(emoji).length).toBe(1);
          expect(toGraphemes(emoji)[0]).toBe(emoji);
        });
      });

      test('treats thumbs up with skin tone as single grapheme', () => {
        const thumbs = '👍🏾';
        expect(toGraphemes(thumbs)).toEqual([thumbs]);
        expect(toGraphemes(thumbs).length).toBe(1);
      });
    });

    describe('combining characters', () => {
      test('treats letter with combining accent as single grapheme', () => {
        // café with combining acute accent on the e
        const cafe = 'cafe\u0301'; // e + combining acute accent
        const graphemes = toGraphemes(cafe);
        expect(graphemes.length).toBe(4);
        expect(graphemes).toEqual(['c', 'a', 'f', 'e\u0301']);
      });

      test('handles precomposed vs decomposed forms', () => {
        // Precomposed é (U+00E9)
        const precomposed = 'café';
        // Decomposed e + combining acute (U+0065 + U+0301)
        const decomposed = 'cafe\u0301';

        expect(toGraphemes(precomposed).length).toBe(4);
        expect(toGraphemes(decomposed).length).toBe(4);
      });

      test('handles multiple combining marks', () => {
        // a with combining acute and combining tilde
        const multiMark = 'a\u0301\u0303';
        expect(toGraphemes(multiMark).length).toBe(1);
      });

      test('handles nasal vowels (Portuguese)', () => {
        // ã with combining tilde
        const nasal = 'a\u0303';
        expect(toGraphemes(nasal).length).toBe(1);
      });
    });

    describe('flag emoji (regional indicators)', () => {
      test('treats US flag as single grapheme', () => {
        const usFlag = '🇺🇸';
        expect(toGraphemes(usFlag)).toEqual([usFlag]);
        expect(toGraphemes(usFlag).length).toBe(1);
      });

      test('treats various flags as single graphemes', () => {
        const flags = ['🇬🇧', '🇫🇷', '🇩🇪', '🇯🇵', '🇧🇷'];
        flags.forEach(flag => {
          expect(toGraphemes(flag).length).toBe(1);
          expect(toGraphemes(flag)[0]).toBe(flag);
        });
      });

      test('handles multiple flags', () => {
        const flags = '🇺🇸🇬🇧🇫🇷';
        expect(toGraphemes(flags)).toEqual(['🇺🇸', '🇬🇧', '🇫🇷']);
        expect(toGraphemes(flags).length).toBe(3);
      });
    });

    describe('keycap sequences', () => {
      test('treats keycap numbers as single grapheme', () => {
        const keycap = '1️⃣';
        expect(toGraphemes(keycap)).toEqual([keycap]);
        expect(toGraphemes(keycap).length).toBe(1);
      });
    });

    describe('edge cases', () => {
      test('handles backspace character itself', () => {
        expect(toGraphemes(BACKSPACE)).toEqual([BACKSPACE]);
        expect(toGraphemes(BACKSPACE).length).toBe(1);
      });

      test('handles mixed complex Unicode', () => {
        const text = 'Hi👨‍👩‍👧!';
        const graphemes = toGraphemes(text);
        expect(graphemes).toEqual(['H', 'i', '👨‍👩‍👧', '!']);
        expect(graphemes.length).toBe(4);
      });
    });
  });

  describe('processT140BackspaceChars - Backspace Handling', () => {

    describe('fast path (no backspaces)', () => {
      test('accumulates text into buffer when no backspaces', () => {
        const result = processT140BackspaceChars('hello', '');
        expect(result.processedText).toBe('hello');
        expect(result.updatedBuffer).toBe('hello');
      });

      test('appends to existing buffer when no backspaces', () => {
        const result = processT140BackspaceChars('world', 'hello');
        expect(result.processedText).toBe('world');
        expect(result.updatedBuffer).toBe('helloworld');
      });
    });

    describe('basic backspace operations', () => {
      test('backspace removes last ASCII character', () => {
        const result = processT140BackspaceChars(`hello${BACKSPACE}`, '');
        expect(result.processedText).toBe(`hello${BACKSPACE}`);
        expect(result.updatedBuffer).toBe('hell');
      });

      test('multiple backspaces remove multiple characters', () => {
        const result = processT140BackspaceChars(
          `hello${BACKSPACE}${BACKSPACE}`,
          ''
        );
        expect(result.updatedBuffer).toBe('hel');
      });

      test('backspace at start of input removes from buffer', () => {
        const result = processT140BackspaceChars(BACKSPACE, 'hello');
        expect(result.processedText).toBe(BACKSPACE);
        expect(result.updatedBuffer).toBe('hell');
      });

      test('backspace on empty buffer is ignored', () => {
        const result = processT140BackspaceChars(BACKSPACE, '');
        expect(result.processedText).toBe('');
        expect(result.updatedBuffer).toBe('');
      });

      test('excess backspaces stop at empty buffer', () => {
        const result = processT140BackspaceChars(
          `${BACKSPACE}${BACKSPACE}${BACKSPACE}${BACKSPACE}${BACKSPACE}`,
          'hi'
        );
        expect(result.updatedBuffer).toBe('');
        // Only 2 backspaces should be in output (one for each char removed)
        expect(result.processedText).toBe(`${BACKSPACE}${BACKSPACE}`);
      });
    });

    describe('backspace with simple emoji', () => {
      test('backspace removes emoji as single unit', () => {
        const result = processT140BackspaceChars(`hello👍${BACKSPACE}`, '');
        expect(result.updatedBuffer).toBe('hello');
      });

      test('backspace removes only the emoji, not ASCII before it', () => {
        const result = processT140BackspaceChars(`hi👍${BACKSPACE}`, '');
        expect(result.updatedBuffer).toBe('hi');
      });

      test('two backspaces remove emoji and preceding char', () => {
        const result = processT140BackspaceChars(
          `hi👍${BACKSPACE}${BACKSPACE}`,
          ''
        );
        expect(result.updatedBuffer).toBe('h');
      });

      test('backspace removes emoji from buffer', () => {
        const result = processT140BackspaceChars(BACKSPACE, 'hello👍');
        expect(result.updatedBuffer).toBe('hello');
      });
    });

    describe('backspace with ZWJ sequences', () => {
      test('backspace removes entire family emoji as single unit', () => {
        const family = '👨‍👩‍👧';
        const result = processT140BackspaceChars(`${family}${BACKSPACE}`, '');
        expect(result.updatedBuffer).toBe('');
      });

      test('backspace removes family emoji, leaving text before', () => {
        const family = '👨‍👩‍👧';
        const result = processT140BackspaceChars(`hello${family}${BACKSPACE}`, '');
        expect(result.updatedBuffer).toBe('hello');
      });

      test('backspace removes ZWJ sequence from buffer', () => {
        const family = '👨‍👩‍👧';
        const result = processT140BackspaceChars(BACKSPACE, `hello${family}`);
        expect(result.updatedBuffer).toBe('hello');
      });

      test('multiple ZWJ sequences handled correctly', () => {
        const family1 = '👨‍👩‍👧';
        const family2 = '👨‍👩‍👦';
        const result = processT140BackspaceChars(
          `${family1}${family2}${BACKSPACE}`,
          ''
        );
        expect(result.updatedBuffer).toBe(family1);
      });
    });

    describe('backspace with skin tone modifiers', () => {
      test('backspace removes emoji with skin tone as single unit', () => {
        const wave = '👋🏽';
        const result = processT140BackspaceChars(`hello${wave}${BACKSPACE}`, '');
        expect(result.updatedBuffer).toBe('hello');
      });

      test('skin tone emoji removed atomically', () => {
        const thumbs = '👍🏾';
        const result = processT140BackspaceChars(`${thumbs}${BACKSPACE}`, '');
        expect(result.updatedBuffer).toBe('');
      });
    });

    describe('backspace with combining characters', () => {
      test('backspace removes letter with combining mark as single unit', () => {
        // café with combining acute accent
        const cafe = 'cafe\u0301';
        const result = processT140BackspaceChars(`${cafe}${BACKSPACE}`, '');
        expect(result.updatedBuffer).toBe('caf');
      });

      test('combining character not separated from base', () => {
        // Just the accented e
        const accentedE = 'e\u0301';
        const result = processT140BackspaceChars(
          `test${accentedE}${BACKSPACE}`,
          ''
        );
        expect(result.updatedBuffer).toBe('test');
      });
    });

    describe('backspace with flag emoji', () => {
      test('backspace removes flag as single unit', () => {
        const flag = '🇺🇸';
        const result = processT140BackspaceChars(`USA${flag}${BACKSPACE}`, '');
        expect(result.updatedBuffer).toBe('USA');
      });

      test('multiple flags handled correctly', () => {
        const result = processT140BackspaceChars(
          `🇺🇸🇬🇧${BACKSPACE}`,
          ''
        );
        expect(result.updatedBuffer).toBe('🇺🇸');
      });
    });

    describe('complex mixed content', () => {
      test('handles interleaved text, emoji, and backspaces', () => {
        const family = '👨‍👩‍👧';
        // Type "Hi", then family emoji, then backspace (removes family), then "!"
        const input = `Hi${family}${BACKSPACE}!`;
        const result = processT140BackspaceChars(input, '');
        expect(result.updatedBuffer).toBe('Hi!');
      });

      test('handles backspace correction mid-word', () => {
        // Type "helo", backspace, then "lo" to correct to "hello"
        const input = `helo${BACKSPACE}lo`;
        const result = processT140BackspaceChars(input, '');
        expect(result.updatedBuffer).toBe('hello');
      });

      test('handles complex Unicode correction sequence', () => {
        const wave = '👋🏽';
        const family = '👨‍👩‍👧';
        // Type wave, backspace (remove wave), type family
        const input = `${wave}${BACKSPACE}${family}`;
        const result = processT140BackspaceChars(input, '');
        expect(result.updatedBuffer).toBe(family);
      });

      test('handles buffer with existing Unicode', () => {
        const family = '👨‍👩‍👧';
        // Buffer has "Hello" + family, new input is backspace + "!"
        const result = processT140BackspaceChars(
          `${BACKSPACE}!`,
          `Hello${family}`
        );
        expect(result.updatedBuffer).toBe('Hello!');
      });
    });

    describe('processedText output correctness', () => {
      test('processedText includes all typed characters', () => {
        const result = processT140BackspaceChars('abc', '');
        expect(result.processedText).toBe('abc');
      });

      test('processedText includes backspaces that were applied', () => {
        const result = processT140BackspaceChars(`ab${BACKSPACE}c`, '');
        expect(result.processedText).toBe(`ab${BACKSPACE}c`);
        expect(result.updatedBuffer).toBe('ac');
      });

      test('processedText excludes backspaces that had nothing to delete', () => {
        const result = processT140BackspaceChars(
          `${BACKSPACE}${BACKSPACE}a`,
          ''
        );
        // No backspaces in output because buffer was empty
        expect(result.processedText).toBe('a');
        expect(result.updatedBuffer).toBe('a');
      });

      test('processedText has correct backspace count with partial buffer', () => {
        const result = processT140BackspaceChars(
          `${BACKSPACE}${BACKSPACE}${BACKSPACE}`,
          'ab'
        );
        // Only 2 backspaces should be output (buffer had 2 chars)
        expect(result.processedText).toBe(`${BACKSPACE}${BACKSPACE}`);
        expect(result.updatedBuffer).toBe('');
      });
    });

    describe('stateful buffer management', () => {
      test('maintains state across multiple calls', () => {
        // Simulate real-time typing
        let buffer = '';

        // Type "hel"
        let result = processT140BackspaceChars('hel', buffer);
        buffer = result.updatedBuffer;
        expect(buffer).toBe('hel');

        // Type "lo"
        result = processT140BackspaceChars('lo', buffer);
        buffer = result.updatedBuffer;
        expect(buffer).toBe('hello');

        // Backspace twice
        result = processT140BackspaceChars(`${BACKSPACE}${BACKSPACE}`, buffer);
        buffer = result.updatedBuffer;
        expect(buffer).toBe('hel');

        // Type "p!"
        result = processT140BackspaceChars('p!', buffer);
        buffer = result.updatedBuffer;
        expect(buffer).toBe('help!');
      });

      test('maintains state with Unicode across calls', () => {
        const thumbs = '👍🏽';
        let buffer = '';

        // Type "Great"
        let result = processT140BackspaceChars('Great', buffer);
        buffer = result.updatedBuffer;
        expect(buffer).toBe('Great');

        // Type thumbs up emoji
        result = processT140BackspaceChars(thumbs, buffer);
        buffer = result.updatedBuffer;
        expect(buffer).toBe(`Great${thumbs}`);

        // Backspace (removes whole emoji)
        result = processT140BackspaceChars(BACKSPACE, buffer);
        buffer = result.updatedBuffer;
        expect(buffer).toBe('Great');

        // Type "!"
        result = processT140BackspaceChars('!', buffer);
        buffer = result.updatedBuffer;
        expect(buffer).toBe('Great!');
      });
    });
  });

  describe('T.140 Specification Compliance', () => {
    test('backspace defined as U+0008 per T.140', () => {
      // T.140 specifies backspace as the BS character (U+0008)
      expect(BACKSPACE).toBe('\u0008');
      expect(BACKSPACE.charCodeAt(0)).toBe(8);
    });

    test('grapheme cluster semantics per T.140 recommendation', () => {
      // T.140 recommends backspace erase "the preceding character"
      // which should be interpreted as grapheme cluster for proper UX
      const family = '👨‍👩‍👧';
      const result = processT140BackspaceChars(`${family}${BACKSPACE}`, '');

      // The family emoji should be treated as ONE character per T.140
      expect(result.updatedBuffer).toBe('');
    });
  });
});
