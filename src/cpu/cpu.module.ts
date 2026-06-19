import { Module } from '@nestjs/common';
import { CpuController } from './cpu.controller';
import { CpuService } from './cpu.service';

@Module({
  controllers: [CpuController],
  providers: [CpuService],
})
export class CpuModule {}
