import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cluster from 'node:cluster';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Worker ${process.pid} listening on :${port}`);
}

/**
 * Fork N worker processes when CLUSTER_WORKERS > 1 so the container uses
 * multiple CPUs. Single-process in dev (when the var is unset).
 * Crashed workers are automatically restarted.
 */
const desiredWorkers = Number(process.env.CLUSTER_WORKERS ?? 0);

if (desiredWorkers > 1 && cluster.isPrimary) {
  console.log(`Primary ${process.pid} forking ${desiredWorkers} workers`);
  for (let i = 0; i < desiredWorkers; i++) cluster.fork();

  cluster.on('exit', (worker, code, signal) => {
    console.log(
      `Worker ${worker.process.pid} died (signal=${signal}, code=${code}); reforking`,
    );
    cluster.fork();
  });
} else {
  void bootstrap();
}
