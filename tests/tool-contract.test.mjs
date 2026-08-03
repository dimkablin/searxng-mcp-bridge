import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('search discovers URLs and fetch reads selected pages', async () => {
  let requestBody;
  const service = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requestBody = JSON.parse(body);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        pages: [{
          url: requestBody.urls[0],
          content: 'Full report text',
          status: 'ok',
          error: null,
        }],
      }));
    });
  });
  await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve));
  const address = service.address();
  assert(address && typeof address === 'object');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['build/index.js'],
    env: {
      ...process.env,
      SEARCH_SERVICE_URL: `http://127.0.0.1:${address.port}`,
      SEARXNG_INSTANCE_URL: 'http://127.0.0.1:1',
    },
  });
  const client = new Client({ name: 'tool-contract-test', version: '1.0.0' });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const search = tools.find((tool) => tool.name === 'search');
    const fetch = tools.find((tool) => tool.name === 'fetch');

    assert.match(search?.description ?? '', /does not fetch/i);
    assert.match(fetch?.description ?? '', /urls returned by.*search/i);
    assert.deepEqual(fetch?.inputSchema.required, ['urls']);

    const result = await client.callTool({
      name: 'fetch',
      arguments: { urls: ['https://example.com/report'] },
    });
    const text = result.content.find((item) => item.type === 'text')?.text;
    assert.equal(JSON.parse(text).pages[0].content, 'Full report text');
    assert.deepEqual(requestBody, { urls: ['https://example.com/report'] });
  } finally {
    await client.close();
    await new Promise((resolve) => service.close(resolve));
  }
});
