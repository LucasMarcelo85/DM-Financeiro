import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInstagramWebhook } from './instagram.js';

test('parses Instagram Direct messages with image attachments and public comments', () => {
  const events = parseInstagramWebhook({
    object: 'instagram',
    entry: [{
      id: 'ig-business-1',
      messaging: [{
        sender: { id: 'customer-1', username: 'cliente' },
        recipient: { id: 'ig-business-1' },
        message: {
          mid: 'message-1',
          text: 'Oi, veja esta foto',
          attachments: [{ type: 'image', payload: { url: 'https://cdninstagram.com/photo.jpg', mime_type: 'image/jpeg' } }],
        },
      }],
      changes: [{
        field: 'comments',
        value: { id: 'comment-1', from: { id: 'customer-2', username: 'outra' }, text: 'Quanto custa?', media: { id: 'post-1' } },
      }],
    }],
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].messages[0].userId, 'customer-1');
  assert.equal(events[0].messages[0].username, 'cliente');
  assert.deepEqual(events[0].messages[0].attachments.map(({ kind, mime }) => ({ kind, mime })), [{ kind: 'image', mime: 'image/jpeg' }]);
  assert.deepEqual(events[0].comments[0], {
    id: 'comment-1', userId: 'customer-2', username: 'outra', text: 'Quanto custa?', mediaId: 'post-1',
  });
});

test('ignores non-Instagram webhook payloads', () => {
  assert.deepEqual(parseInstagramWebhook({ object: 'whatsapp_business_account', entry: [] }), []);
});
