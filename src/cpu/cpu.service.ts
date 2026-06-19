import { Injectable } from '@nestjs/common';

export interface CpuBenchmarkResult {
  result: unknown;
  durationMs: number;
  input: Record<string, number>;
}

/**
 * Wrap a synchronous CPU-bound task and measure how long it took.
 * Runs in the main thread, so it will block the event loop — useful for
 * demonstrating back-pressure / clustering / worker-thread optimizations.
 */
function time<T>(
  task: () => T,
  input: Record<string, number>,
): CpuBenchmarkResult {
  const start = process.hrtime.bigint();
  const result = task();
  const end = process.hrtime.bigint();
  return {
    result,
    durationMs: Number(end - start) / 1e6,
    input,
  };
}

@Injectable()
export class CpuService {
  /** Count primes up to `limit` using trial division — O(n * sqrt(n)). */
  countPrimes(limit: number): CpuBenchmarkResult {
    return time(
      () => {
        let count = 0;
        for (let n = 2; n <= limit; n++) {
          if (this.isPrime(n)) count++;
        }
        return { count, limit };
      },
      { limit },
    );
  }

  private isPrime(n: number): boolean {
    if (n < 2) return false;
    if (n % 2 === 0) return n === 2;
    const sqrt = Math.floor(Math.sqrt(n));
    for (let i = 3; i <= sqrt; i += 2) {
      if (n % i === 0) return false;
    }
    return true;
  }

  /** Naive recursive Fibonacci — exponential time, classic CPU hog. */
  fibonacci(n: number): CpuBenchmarkResult {
    return time(
      () => {
        const value = this.fib(n);
        return { n, value };
      },
      { n },
    );
  }

  private fib(n: number): number {
    if (n < 2) return n;
    return this.fib(n - 1) + this.fib(n - 2);
  }

  /** Bubble sort a random array of `size` elements — O(n^2). */
  bubbleSort(size: number): CpuBenchmarkResult {
    return time(
      () => {
        const arr = this.randomArray(size);
        let swaps = 0;
        for (let i = 0; i < arr.length - 1; i++) {
          for (let j = 0; j < arr.length - i - 1; j++) {
            if (arr[j] > arr[j + 1]) {
              const tmp = arr[j];
              arr[j] = arr[j + 1];
              arr[j + 1] = tmp;
              swaps++;
            }
          }
        }
        return { size, swaps, sorted: arr };
      },
      { size },
    );
  }

  /**
   * Naive (non-Strassen) square matrix multiplication — O(n^3).
   * Returns just the trace of the result to keep the response small.
   */
  matrixMultiply(size: number): CpuBenchmarkResult {
    return time(
      () => {
        const a = this.randomMatrix(size);
        const b = this.randomMatrix(size);
        const c = new Array(size);
        for (let i = 0; i < size; i++) {
          c[i] = new Array(size).fill(0);
          for (let j = 0; j < size; j++) {
            let sum = 0;
            for (let k = 0; k < size; k++) {
              sum += a[i][k] * b[k][j];
            }
            c[i][j] = sum;
          }
        }
        let trace = 0;
        for (let i = 0; i < size; i++) trace += c[i][i];
        return { size, trace };
      },
      { size },
    );
  }

  /** Estimate Pi via the Leibniz series — slowly converging, CPU bound. */
  estimatePi(iterations: number): CpuBenchmarkResult {
    return time(
      () => {
        let pi = 0;
        for (let i = 0; i < iterations; i++) {
          const term = (4 * (i % 2 === 0 ? 1 : -1)) / (2 * i + 1);
          pi += term;
        }
        return { iterations, pi };
      },
      { iterations },
    );
  }

  /** Hash a string `rounds` times using SHA-256 (Node's built-in crypto). */
  hashRounds(rounds: number): CpuBenchmarkResult {
    return time(
      () => {
        let data = 'core-optimize';
        for (let i = 0; i < rounds; i++) {
          data = this.sha256(data);
        }
        return { rounds, hash: data };
      },
      { rounds },
    );
  }

  private sha256(input: string): string {
    const { createHash } = require('node:crypto');
    return createHash('sha256').update(input).digest('hex');
  }

  private randomArray(size: number): number[] {
    const arr = new Array(size);
    for (let i = 0; i < size; i++)
      arr[i] = Math.floor(Math.random() * 1_000_000);
    return arr;
  }

  private randomMatrix(size: number): number[][] {
    const m = new Array(size);
    for (let i = 0; i < size; i++) {
      m[i] = new Array(size);
      for (let j = 0; j < size; j++) m[i][j] = Math.random();
    }
    return m;
  }
}
