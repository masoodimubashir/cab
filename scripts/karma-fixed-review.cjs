const path = require('node:path');
module.exports = config => {
  const app = process.env.CAB_REVIEW_APP || 'driver-mobile';
  require(path.join(__dirname, '..', app, 'karma.conf.js'))(config);
  config.set({
    basePath: path.join(__dirname, '..', app),
    customLaunchers: {
      ChromeReview: {
        base: 'ChromeHeadless',
        flags: ['--disable-gpu', '--in-process-gpu', '--disable-software-rasterizer', '--no-sandbox'],
      },
    },
    browsers: ['ChromeReview'],
    singleRun: true,
    autoWatch: false,
  });
};
