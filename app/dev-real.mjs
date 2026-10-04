// Servidor de desarrollo con la data local real (la misma que se publica), sin pasar por peruvian.dev.
process.env.ERM_DATA_ORIGIN = 'http://localhost:5101';
process.env.ERM_API_ORIGIN = 'http://localhost:8898';   // servicio de público en local (deploy/viewers/server.mjs)
const { createServer } = await import('vite');
const server = await createServer({ server: { port: 5177 } });
await server.listen();
server.printUrls();
