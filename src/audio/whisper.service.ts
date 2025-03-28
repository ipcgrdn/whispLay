import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as FormData from 'form-data';
import axios from 'axios';

@Injectable()
export class WhisperService {
  private readonly logger = new Logger(WhisperService.name);
  private readonly lemonfoxApiKey: string;
  
  constructor() {
    // Lemonfox API 키 확인
    const apiKey = process.env.LEMONFOX_API_KEY;
    if (!apiKey) {
      this.logger.error('Lemonfox API 키가 설정되지 않았습니다. .env 파일을 확인하세요.');
      this.lemonfoxApiKey = '';
    } else {
      this.lemonfoxApiKey = apiKey;
    }
    
    this.logger.log('WhisperService (Lemonfox 기반) 초기화됨');
  }
  
  /**
   * WAV 파일을 Lemonfox API로 전송하여 텍스트로 변환
   * @param filePath 변환할 오디오 파일 경로
   * @returns 변환된 텍스트와 처리 결과
   */
  public async transcribeAudio(filePath: string): Promise<{ 
    success: boolean; 
    text?: string; 
    detectedLanguage?: string;
    error?: string; 
    processingTime?: number;
  }> {
    const startTime = new Date().getTime();
    
    try {
      // 파일 존재 여부 확인
      if (!fs.existsSync(filePath)) {
        throw new Error(`파일이 존재하지 않습니다: ${filePath}`);
      }
      
      this.logger.log(`오디오 파일 변환 시작: ${path.basename(filePath)}`);
      
      // FormData 생성
      const formData = new FormData();
      formData.append('file', fs.createReadStream(filePath));
      formData.append('response_format', 'json');
      
      // 언어 감지 개선을 위한 파라미터 추가
      // Lemonfox API가 자동으로 언어를 감지하도록 설정
      // 특정 언어를 강제하지 않음
      
      // Lemonfox API 호출
      const response = await axios.post('https://api.lemonfox.ai/v1/audio/transcriptions', 
        formData, 
        {
          headers: {
            'Authorization': `Bearer ${this.lemonfoxApiKey}`,
            ...formData.getHeaders()
          }
        }
      );
      
      const processingTime = new Date().getTime() - startTime;
      this.logger.log(`오디오 파일 변환 완료: ${path.basename(filePath)} (${processingTime}ms)`);
      
      // 응답 결과 처리
      const result = response.data;
      
      // 텍스트 내용 기반의 언어 감지 보강
      // 영어로 인식된 텍스트인 경우 'en' 언어 코드 지정
      let detectedLanguage = 'ko'; // 기본값은 한국어
      
      // 영문자 비율 확인 (간단한 휴리스틱)
      if (result.text && result.text.length > 0) {
        const englishCharCount = (result.text.match(/[a-zA-Z]/g) || []).length;
        const textLength = result.text.length;
        
        // 50% 이상이 영문자면 영어로 판단
        if (englishCharCount / textLength > 0.5) {
          detectedLanguage = 'en';
          this.logger.log(`텍스트 내용 분석: 영어 텍스트로 감지됨 (영문자 비율: ${Math.round(englishCharCount / textLength * 100)}%)`);
        }
      }
      
      return {
        success: true,
        text: result.text,
        detectedLanguage: detectedLanguage, // 자체 분석한 언어 코드 사용
        processingTime
      };
    } catch (error) {
      const processingTime = new Date().getTime() - startTime;
      this.logger.error(`오디오 변환 오류: ${error.message}`);
      
      return {
        success: false,
        error: error.message,
        processingTime
      };
    }
  }
}