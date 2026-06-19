import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { CpuService } from './cpu.service';

/**
 * Clamp a query value into [min, max], falling back to `defaultValue`
 * when missing or invalid. Returns a useful 400 error message on failure.
 */
function clamp(
  raw: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
  name: string,
): number {
  if (raw === undefined || raw === '') return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new BadRequestException(`${name} must be a number`);
  }
  if (n < min || n > max) {
    throw new BadRequestException(`${name} must be between ${min} and ${max}`);
  }
  return Math.floor(n);
}

@Controller('cpu')
export class CpuController {
  constructor(private readonly cpuService: CpuService) {}

  /** Count primes up to ?limit= (default 100_000, max 5_000_000). */
  @Get('primes')
  primes(@Query('limit') limit: string) {
    return this.cpuService.countPrimes(
      clamp(limit, 100_000, 2, 5_000_000, 'limit'),
    );
  }

  /** Naive recursive Fibonacci of ?n= (default 30, max 45). */
  @Get('fibonacci')
  fibonacci(@Query('n') n: string) {
    return this.cpuService.fibonacci(clamp(n, 30, 0, 45, 'n'));
  }

  /** Bubble sort a random array of ?size= (default 10_000, max 100_000). */
  @Get('sort')
  sort(@Query('size') size: string) {
    return this.cpuService.bubbleSort(clamp(size, 10_000, 1, 100_000, 'size'));
  }

  /** Multiply two random NxN matrices, ?size= (default 200, max 800). */
  @Get('matrix')
  matrix(@Query('size') size: string) {
    return this.cpuService.matrixMultiply(clamp(size, 200, 1, 800, 'size'));
  }

  /** Estimate Pi via Leibniz series over ?iterations= (default 10_000_000, max 1_000_000_000). */
  @Get('pi')
  pi(@Query('iterations') iterations: string) {
    return this.cpuService.estimatePi(
      clamp(iterations, 10_000_000, 1, 1_000_000_000, 'iterations'),
    );
  }

  /** SHA-256 hash a string repeatedly, ?rounds= (default 100_000, max 5_000_000). */
  @Get('hash')
  hash(@Query('rounds') rounds: string) {
    return this.cpuService.hashRounds(
      clamp(rounds, 100_000, 1, 5_000_000, 'rounds'),
    );
  }
}
