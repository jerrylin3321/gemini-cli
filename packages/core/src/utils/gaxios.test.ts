/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { request, GaxiosError } from 'gaxios';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';

// See https://github.com/google-gemini/gemini-cli/pull/21884 for context about the issue
describe('gaxios stream corruption regression test', () => {
  it('should handle stream error responses split across multiple chunks without corrupting them with commas', async () => {
    const chunks = [
      '{"error": {"code": 500, ',
      '"message": "Internal ',
      'Error", "status": "INTERNAL_ERROR"}}',
    ];

    const server = createServer((req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      Readable.from(chunks).pipe(res);
    });

    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );
    const address = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;

    try {
      await request({
        url,
        method: 'POST',
        responseType: 'stream',
      });
      throw new Error('Should have failed');
    } catch (err) {
      expect(err).toBeInstanceOf(GaxiosError);
      const gaxiosError = err as GaxiosError;

      // On older versions of gaxios (e.g. v6.x), the error message is not populated with the
      // stream response data, and starts with "Request failed with status code". These versions
      // are not affected by the stream corruption bug.
      if (gaxiosError.message.startsWith('Request failed')) {
        return;
      }

      const apiError = JSON.parse(gaxiosError.message);
      expect(apiError.error.code).toBe(500);
      expect(apiError.error.message).toBe('Internal Error');
      expect(apiError.error.status).toBe('INTERNAL_ERROR');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
