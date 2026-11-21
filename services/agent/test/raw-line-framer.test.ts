import assert from "node:assert/strict";
import test from "node:test";
import { RawLineFramer } from "../src/raw-line-framer.ts";

test("emits multiple complete lines", () => {
  const framer = new RawLineFramer();
  const events = framer.push(Buffer.from("first\nsecond\n", "utf8"));

  assert.deepEqual(events.map((event) => event.byteOffset), [0n, 6n]);
  assert.deepEqual(events.map((event) => event.rawEventBytes), [
    Buffer.from("first\n"),
    Buffer.from("second\n"),
  ]);
});

test("supports lines split across pushes", () => {
  const framer = new RawLineFramer();

  assert.deepEqual(framer.push(Buffer.from("hel")), []);

  const events = framer.push(Buffer.from("lo\nnext"));
  assert.equal(events.length, 1);
  assert.equal(events[0].byteOffset, 0n);
  assert.deepEqual(events[0].rawEventBytes, Buffer.from("hello\n"));
  assert.deepEqual(framer.push(Buffer.from("\n")), [{
    byteOffset: 6n,
    rawEventBytes: Buffer.from("next\n"),
  }]);
});

test("preserves CR bytes from CRLF input", () => {
  const framer = new RawLineFramer();
  const events = framer.push(Buffer.from("alpha\r\nbeta\r\n"));

  assert.deepEqual(events[0].rawEventBytes, Buffer.from("alpha\r\n"));
  assert.deepEqual(events[1].rawEventBytes, Buffer.from("beta\r\n"));
});

test("preserves non-UTF-8 bytes", () => {
  const framer = new RawLineFramer();
  const events = framer.push(Uint8Array.from([0xff, 0x00, 0x80, 0x0a]));

  assert.deepEqual(events, [{
    byteOffset: 0n,
    rawEventBytes: Buffer.from([0xff, 0x00, 0x80, 0x0a]),
  }]);
});

test("includes blank lines", () => {
  const framer = new RawLineFramer();
  const events = framer.push(Buffer.from("\n\nx\n"));

  assert.equal(events.length, 3);
  assert.deepEqual(events[0].rawEventBytes, Buffer.from("\n"));
  assert.equal(events[0].byteOffset, 0n);
  assert.deepEqual(events[1].rawEventBytes, Buffer.from("\n"));
  assert.equal(events[1].byteOffset, 1n);
  assert.deepEqual(events[2].rawEventBytes, Buffer.from("x\n"));
  assert.equal(events[2].byteOffset, 2n);
});

test("uses a nonzero initial offset", () => {
  const framer = new RawLineFramer(123n);
  const events = framer.push(Buffer.from("a\nbc\n"));

  assert.deepEqual(events.map((event) => event.byteOffset), [123n, 125n]);
  assert.deepEqual(events.map((event) => event.rawEventBytes), [
    Buffer.from("a\n"),
    Buffer.from("bc\n"),
  ]);
});

test("does not emit an incomplete line", () => {
  const framer = new RawLineFramer();

  assert.deepEqual(framer.push(Buffer.from("pending")), []);
  assert.deepEqual(framer.push(Buffer.from(" data")), []);
  assert.deepEqual(framer.push(Buffer.from("\n")), [{
    byteOffset: 0n,
    rawEventBytes: Buffer.from("pending data\n"),
  }]);
});
