import { createApp } from './api/app.ts';
import { config } from './config/index.ts';

const app = createApp();

app.listen(config.port, config.host, () => {
  console.log(`TRUSTTRACE backend listening on http://${config.host}:${config.port}`);
});
