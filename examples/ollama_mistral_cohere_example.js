/**
 * Example of using t140llm with Ollama, Mistral AI, and Cohere
 * 
 * This example demonstrates using t140llm to process AI streams
 * from different LLM providers
 */

const { processAIStream } = require('../dist');
const { EventEmitter } = require('events');

// For Ollama, you'd typically use fetch or axios to call the API
async function streamFromOllama() {
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama3',
      prompt: 'Write a haiku about programming',
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  // Create an event emitter to simulate a stream
  const stream = new EventEmitter();
  
  // Process chunks as they arrive
  const processChunks = async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        stream.emit('end');
        break;
      }
      // Parse each SSE chunk
      const text = decoder.decode(value);
      const lines = text.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          // Emit the Ollama format chunk
          stream.emit('data', json);
        } catch (e) {
          console.error('Error parsing Ollama response:', e);
        }
      }
    }
  };
  
  processChunks().catch(err => stream.emit('error', err));
  return stream;
}

// For Mistral (requires @mistralai/mistralai package)
async function streamFromMistral() {
  const MistralClient = require('@mistralai/mistralai').default;
  
  const mistral = new MistralClient({
    apiKey: process.env.MISTRAL_API_KEY,
  });

  const stream = await mistral.chat({
    model: 'mistral-large-latest',
    messages: [{ role: 'user', content: 'Write a haiku about programming' }],
    stream: true,
  });
  
  return stream;
}

// For Cohere (requires cohere-ai package)
async function streamFromCohere() {
  const { CohereClient } = require('cohere-ai');
  
  const cohere = new CohereClient({
    token: process.env.COHERE_API_KEY,
  });

  const stream = await cohere.chatStream({
    model: 'command',
    message: 'Write a haiku about programming',
  });
  
  return stream;
}

async function main() {
  try {
    // Choose which provider to use
    const provider = process.argv[2] || 'ollama';
    let stream;
    
    switch (provider) {
      case 'ollama':
        console.log('Streaming from Ollama...');
        stream = await streamFromOllama();
        break;
      case 'mistral':
        console.log('Streaming from Mistral AI...');
        stream = await streamFromMistral();
        break;
      case 'cohere':
        console.log('Streaming from Cohere...');
        stream = await streamFromCohere();
        break;
      case 'gemini':
        console.log('Streaming from Google Gemini...');
        // Import Gemini stream function from separate example
        const { streamFromGemini } = require('./gemini_example');
        stream = await streamFromGemini();
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
    
    // Process the stream with t140llm
    processAIStream(stream, 'ws://localhost:8765', {
      processBackspaces: true,
      handleMetadata: true,
      metadataCallback: (metadata) => {
        console.log('Received metadata:', metadata.type);
      },
    });
    
    console.log(`Streaming from ${provider} started`);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the example
main();
