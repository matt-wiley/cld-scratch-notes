import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, inline, toggleTask } from '../js/md.js';

test('escapes html everywhere', () => {
  const html = render('<script>alert(1)</script>\n\n`<b>`\n\n```\n<i>\n```');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<code class="copy" title="Click to copy">&lt;b&gt;</code>'));
  assert.ok(html.includes('<pre><code>&lt;i&gt;</code></pre>'));
});

test('inline formatting', () => {
  assert.equal(inline('**b** and _i_ and ~~s~~'), '<strong>b</strong> and <em>i</em> and <del>s</del>');
  assert.equal(inline('snake_case_name stays'), 'snake_case_name stays');
  assert.equal(inline('*.js and *.ts'), '*.js and *.ts');
  assert.match(inline('`**not bold**`'), /<code[^>]*>\*\*not bold\*\*<\/code>/);
});

test('links: markdown, autolinks, bare urls, unsafe schemes', () => {
  assert.match(inline('[x](https://a.com)'), /<a href="https:\/\/a.com"[^>]*>x<\/a>/);
  assert.match(inline('see https://a.com/p?q=1&r=2.'), /href="https:\/\/a.com\/p\?q=1&amp;r=2"[^>]*>https:\/\/a.com\/p\?q=1&amp;r=2<\/a>\.$/);
  assert.match(inline('<https://b.com>'), /href="https:\/\/b.com"/);
  assert.ok(!inline('[x](javascript:alert(1))').includes('<a'));
});

test('each paragraph line is its own copy target', () => {
  const html = render('one\ntwo **b**');
  assert.match(html, /^<p><span class="line" data-copy="one">one<button/);
  assert.match(html, /<span class="line" data-copy="two \*\*b\*\*">two <strong>b<\/strong><button/);
});

test('headings, hr, blockquote', () => {
  const html = render('# A\n## B ##\n---\n> quoted\n> more');
  assert.ok(html.includes('<h1>A</h1>'));
  assert.ok(html.includes('<h2>B</h2>'));
  assert.ok(html.includes('<hr>'));
  assert.match(html, /<blockquote><p>.*quoted.*more.*<\/p><\/blockquote>/);
});

test('nested lists, ordered start, copy text per item', () => {
  const html = render('- a\n  - b\n- c\n\n3. x\n4. y');
  assert.match(html, /^<ul><li><div class="item" data-copy="a">/);
  assert.match(html, /<ul><li><div class="item" data-copy="b">/);
  assert.ok(html.includes('<ol start="3">'));
});

test('loose lists stay one list', () => {
  const html = render('- a\n\n- b');
  assert.equal((html.match(/<ul>/g) || []).length, 1);
});

test('task items and toggling by source line', () => {
  const src = 'title\n\n- [ ] one\n- [x] two\n> - [ ] quoted';
  const html = render(src);
  assert.match(html, /data-line="2"(?! checked)/);
  assert.match(html, /data-line="3" checked/);
  assert.match(html, /data-line="4"/);
  assert.equal(toggleTask(src, 2).split('\n')[2], '- [x] one');
  assert.equal(toggleTask(src, 3).split('\n')[3], '- [ ] two');
  assert.equal(toggleTask(src, 4).split('\n')[4], '> - [x] quoted');
  assert.equal(toggleTask(src, 0), src);
});

test('fenced code keeps content and language', () => {
  const html = render('```bash\necho "hi" && ls\n\nmore\n```\nafter');
  assert.match(html, /data-copy="echo &quot;hi&quot; &amp;&amp; ls\n\nmore"/);
  assert.ok(html.includes('<span class="code-lang">bash</span>'));
  assert.ok(html.includes('<span class="line" data-copy="after">'));
});

test('unclosed fence runs to the end', () => {
  assert.match(render('```\nabc'), /<pre><code>abc<\/code><\/pre>/);
});

test('tables', () => {
  const html = render('| a | b |\n|---|:-:|\n| 1 | `2` |\n| 3 |');
  assert.ok(html.includes('<th>a</th><th>b</th>'));
  assert.ok(html.includes('<td>1</td>'));
  assert.ok(html.includes('<td>3</td><td></td>'));
});

test('an unindented line after a list ends it; indented lines continue the item', () => {
  const html = render('- a\ntoken: x\n- b\n  more of b');
  assert.match(html, /<ul><li><div class="item" data-copy="a">.*<\/ul><p><span class="line" data-copy="token: x">/);
  assert.match(html, /data-copy="b\nmore of b"/);
});
