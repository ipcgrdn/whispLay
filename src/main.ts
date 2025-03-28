import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import * as dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  
  // CORS 설정
  app.enableCors();
  
  // 정적 파일 제공
  app.useStaticAssets(join(__dirname, '..', 'public'));
  
  await app.listen(process.env.PORT ?? 3000);
  console.log(`애플리케이션이 http://localhost:${process.env.PORT ?? 3000} 에서 실행 중입니다.`);
}
bootstrap();
