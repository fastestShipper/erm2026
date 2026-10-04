// Servidor de desarrollo con datos de prueba (simulador local en :5100) en vez de los reales.
process.env.ERM_DATA_ORIGIN = 'http://localhost:5100';
const { createServer } = await import('vite');
const server = await createServer({ server: { port: 5175 } });
await server.listen();
server.printUrls();
