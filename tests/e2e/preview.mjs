import { startPreview } from '../../scripts/serve-dist.mjs';

export default async function setup(config) {
  const { port } = new URL(config.projects[0].use.baseURL);
  const server = await startPreview(Number(port));
  return () => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}
