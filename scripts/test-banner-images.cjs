const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../customer-mobile/node_modules/typescript');

function loadPage(relative, apiUrl) {
  const filename = path.join(__dirname, '..', relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, URL, console,
    require: name => {
      if (name.endsWith('/environments/environment')) return { environment: { apiUrl } };
      if (name === '@angular/core') return {
        Component: () => value => value, ViewChild: () => () => {},
        ChangeDetectionStrategy: { OnPush: 0 },
      };
      return {};
    },
  }, { filename });
  return exports;
}

for (const [app, relative, className] of [
  ['customer', 'customer-mobile/src/app/pages/booking/home/booking-home.page.ts', 'BookingHomePage'],
  ['driver', 'driver-mobile/src/app/pages/dashboard/dashboard.page.ts', 'DashboardPage'],
]) {
  test(`${app} resolves banner URLs against the secure API`, () => {
    const Page = loadPage(relative, 'https://dreamcabs.in/api')[className];
    const page = Object.create(Page.prototype);
    const cases = [
      ['http://dreamcabs.in/storage/app_banners/promo.png', 'https://dreamcabs.in/storage/app_banners/promo.png'],
      ['https://dreamcabs.in/storage/app_banners/promo.png', 'https://dreamcabs.in/storage/app_banners/promo.png'],
      ['/storage/app_banners/promo.png', 'https://dreamcabs.in/storage/app_banners/promo.png'],
      ['storage/app_banners/promo.png', 'https://dreamcabs.in/storage/app_banners/promo.png'],
      ['http://localhost:8000/storage/promo.png?version=2', 'https://dreamcabs.in/storage/promo.png?version=2'],
      ['https://127.0.0.1/storage/promo.png', 'https://dreamcabs.in/storage/promo.png'],
      ['https://cdn.example.com/promo.png?signature=abc', 'https://cdn.example.com/promo.png?signature=abc'],
      ['//cdn.example.com/promo.png', 'https://cdn.example.com/promo.png'],
      ['http://other.example.com/promo.png', 'http://other.example.com/promo.png'],
      ['javascript:alert(1)', ''], [null, ''], [undefined, ''], ['  ', ''],
    ];
    for (const [input, expected] of cases) assert.equal(page.resolveBannerImageUrl(input), expected, String(input));
  });

  test(`${app} retains HTTP for local development`, () => {
    const Page = loadPage(relative, 'http://localhost:8000/api')[className];
    const page = Object.create(Page.prototype);
    assert.equal(page.resolveBannerImageUrl('/storage/promo.png'), 'http://localhost:8000/storage/promo.png');
  });
}
