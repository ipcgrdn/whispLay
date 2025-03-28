import { Injectable, Logger } from '@nestjs/common';
import * as deepl from 'deepl-node';
import { splitIntoSentences, cleanText } from '../utils/text-processing';

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private readonly translator: deepl.Translator;
  private readonly defaultTargetLang: string = 'ko'; // 기본 대상 언어: 한국어

  // Whisper API 언어 이름을 DeepL API 언어 코드로 변환하는 매핑
  private readonly languageMapping: Record<string, deepl.SourceLanguageCode | null> = {
    // 언어 이름
    'english': 'en',
    'korean': 'ko',
    'japanese': 'ja',
    'chinese': 'zh',
    'french': 'fr',
    'german': 'de',
    'spanish': 'es',
    'italian': 'it',
    'portuguese': 'pt',
    'russian': 'ru',
    'dutch': 'nl',
    'polish': 'pl',
    'turkish': 'tr',
    'arabic': null, // DeepL에서 지원하지 않는 언어는 null로 설정하여 자동 감지 사용
    'hindi': null,
    'bengali': null,
    
    // ISO 언어 코드
    'en': 'en',
    'ko': 'ko',
    'ja': 'ja',
    'zh': 'zh',
    'fr': 'fr',
    'de': 'de',
    'es': 'es',
    'it': 'it',
    'pt': 'pt',
    'ru': 'ru',
    'nl': 'nl',
    'pl': 'pl',
    'tr': 'tr'
  };

  constructor() {
    // DeepL API 키 확인
    const apiKey = process.env.DEEPL_API_KEY;
    if (!apiKey) {
      this.logger.error('DeepL API 키가 설정되지 않았습니다. .env 파일을 확인하세요.');
      throw new Error('DeepL API 키가 설정되지 않았습니다');
    }
    
    // DeepL 인스턴스 초기화 - Free API 엔드포인트 명시적 사용
    this.translator = new deepl.Translator(apiKey, { 
      serverUrl: 'https://api-free.deepl.com'  // Free API 엔드포인트 명시
    });
    
    this.logger.log('TranslationService 초기화됨');
    
    // API 사용량 확인 
    this.checkUsage().catch(err => {
      this.logger.error(`DeepL API 사용량 확인 오류: ${err.message}`);
      // 오류 발생해도 서비스는 계속 실행되도록 함
    });
  }
  
  /**
   * Whisper API에서 감지된 언어를 DeepL API 언어 코드로 변환
   * @param whisperLanguage Whisper API에서 감지된 언어 이름
   * @returns DeepL API 언어 코드 또는 null (자동 감지)
   */
  private convertToDeepLLanguageCode(whisperLanguage: string | null): deepl.SourceLanguageCode | null {
    if (!whisperLanguage) return null;
    
    // 소문자로 변환
    const normalizedLanguage = whisperLanguage.toLowerCase();
    
    // ISO 코드인 경우 그대로 사용 (언어 코드가 2~3글자인 경우)
    if (normalizedLanguage.length <= 3) {
      // 유효한 DeepL 언어 코드인지 확인
      const validIsoCodes = ['bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'zh'];
      
      if (validIsoCodes.includes(normalizedLanguage)) {
        this.logger.debug(`유효한 ISO 언어 코드 감지됨: '${normalizedLanguage}'`);
        return normalizedLanguage as deepl.SourceLanguageCode;
      }
    }
    
    // 매핑된 언어 코드 반환 (없으면 null)
    const languageCode = this.languageMapping[normalizedLanguage];
    
    if (!languageCode) {
      this.logger.warn(`언어 '${whisperLanguage}'에 대한 DeepL 언어 코드를 찾을 수 없습니다. 자동 감지를 사용합니다.`);
    } else {
      this.logger.debug(`언어 변환: '${whisperLanguage}' -> '${languageCode}'`);
    }
    
    return languageCode;
  }
  
  /**
   * DeepL API 사용량 확인
   */
  private async checkUsage(): Promise<void> {
    try {
      const usage = await this.translator.getUsage();
      if (usage.character) {
        this.logger.log(`DeepL API 사용량: ${usage.character.count}/${usage.character.limit} 문자`);
      }
    } catch (error) {
      this.logger.error(`DeepL API 사용량 확인 오류: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * 소스 언어에 따라 대상 언어 결정
   * 한국어인 경우 영어로, 그 외에는 한국어로 번역
   * @param sourceLang 소스 언어 코드
   * @returns 대상 언어 코드
   */
  private determineTargetLanguage(sourceLang: string | null): deepl.TargetLanguageCode {
    // 소스 언어가 한국어인 경우
    if (sourceLang === 'ko' || sourceLang === 'korean') {
      this.logger.log('원본 언어가 한국어로 감지되어 영어로 번역합니다.');
      return 'en-US' as deepl.TargetLanguageCode;
    }
    
    // 그 외의 경우 한국어로 번역
    return this.defaultTargetLang as deepl.TargetLanguageCode;
  }
  
  /**
   * 단일 텍스트 번역
   * @param text 번역할 텍스트
   * @param sourceLang 원본 언어 (자동 감지: null)
   * @param targetLang 대상 언어 (기본값: 언어에 따라 자동 결정)
   * @returns 번역 결과와 상태 정보
   */
  public async translateText(
    text: string, 
    sourceLang: deepl.SourceLanguageCode | null = null,
    targetLang?: deepl.TargetLanguageCode
  ): Promise<{ 
    success: boolean; 
    originalText: string;
    translatedText?: string; 
    detectedLanguage?: string;
    error?: string; 
  }> {
    if (!text || text.trim() === '') {
      return {
        success: false,
        originalText: text,
        error: '번역할 텍스트가 없습니다'
      };
    }
    
    try {
      // 텍스트 정리
      const cleanedText = cleanText(text);
      
      this.logger.log(`텍스트 번역 시작: "${cleanedText.substring(0, 50)}${cleanedText.length > 50 ? '...' : ''}"`);
      
      // 소스 언어가 한국어인 경우, 영어로 번역하기 위해 targetLang 결정
      const actualTargetLang = targetLang || this.determineTargetLanguage(sourceLang);
      
      // DeepL로 번역 요청
      const result = await this.translator.translateText(
        cleanedText,
        sourceLang,
        actualTargetLang,
        {
          preserveFormatting: true,
          formality: 'default'
        }
      );
      
      // 단일 텍스트 번역 결과
      const translation = Array.isArray(result) ? result[0] : result;
      
      // 원본 언어가 변경된 경우 대상 언어를 다시 결정
      // (자동 감지로 인해 원본 언어가 바뀔 수 있음)
      if (!sourceLang && translation.detectedSourceLang) {
        const detectedSourceLang = translation.detectedSourceLang;
        
        // 감지된 언어가 한국어인데 대상 언어가 한국어인 경우 재번역
        if ((detectedSourceLang === 'ko') && actualTargetLang === this.defaultTargetLang) {
          this.logger.log('감지된 언어가 한국어입니다. 영어로 다시 번역합니다.');
          return this.translateText(text, 'ko' as deepl.SourceLanguageCode, 'en-US' as deepl.TargetLanguageCode);
        }
      }
      
      this.logger.log(`번역 완료 [${translation.detectedSourceLang} -> ${actualTargetLang}]`);
      
      return {
        success: true,
        originalText: cleanedText,
        translatedText: translation.text,
        detectedLanguage: translation.detectedSourceLang
      };
    } catch (error) {
      this.logger.error(`번역 오류: ${error.message}`);
      return {
        success: false,
        originalText: text,
        error: error.message
      };
    }
  }
  
  /**
   * 텍스트를 문장 단위로 나누어 번역
   * @param text 번역할 전체 텍스트
   * @param sourceLang 원본 언어 (자동 감지: null)
   * @param targetLang 대상 언어 (기본값: 자동 결정)
   * @returns 문장별 번역 결과 배열
   */
  public async translateBySentences(
    text: string,
    sourceLang: string | null = null,
    targetLang?: deepl.TargetLanguageCode
  ): Promise<{
    success: boolean;
    originalText: string;
    translatedText?: string;
    sentences?: Array<{
      original: string;
      translated: string;
      success: boolean;
      error?: string;
    }>;
    error?: string;
  }> {
    if (!text || text.trim() === '') {
      return {
        success: false,
        originalText: text,
        error: '번역할 텍스트가 없습니다'
      };
    }
    
    try {
      // 텍스트 정리
      const cleanedText = cleanText(text);
      
      // 소스 언어에 따라 대상 언어 결정
      const actualTargetLang = targetLang || this.determineTargetLanguage(sourceLang);
      
      // 감지된 언어가 한국어인 경우 targetLang을 영어로 변경
      if (sourceLang === 'ko' || sourceLang === 'korean') {
        this.logger.log('원본 언어가 한국어로 감지되어 영어로 번역합니다.');
      }
      
      // 원본 언어 코드 변환
      const deeplSourceLang = this.convertToDeepLLanguageCode(sourceLang);
      
      // 문장 분리
      const sentences = splitIntoSentences(cleanedText);
      
      this.logger.log(`원본 텍스트: "${cleanedText.substring(0, 100)}${cleanedText.length > 100 ? '...' : ''}"`);
      this.logger.log(`분리된 문장 수: ${sentences.length}`);
      
      if (sentences.length === 0) {
        this.logger.warn('문장 분리 결과가 없습니다. 원본 텍스트 전체를 하나의 문장으로 처리합니다.');
        sentences.push(cleanedText);
      } else {
        // 분리된 문장 샘플 로깅 (최대 3개)
        const sampleCount = Math.min(3, sentences.length);
        for (let i = 0; i < sampleCount; i++) {
          this.logger.log(`문장 ${i+1} 샘플: "${sentences[i]}"`);
        }
      }
      
      if (sentences.length === 0) {
        return {
          success: false,
          originalText: cleanedText,
          error: '문장 분리 실패'
        };
      }
      
      this.logger.log(`${sentences.length}개 문장 번역 시작 (소스 언어: ${deeplSourceLang || '자동 감지'})`);
      
      // 각 문장 번역 (병렬 처리)
      const translationPromises = sentences.map(async (sentence, index) => {
        try {
          this.logger.debug(`문장 ${index+1} 번역 시도: "${sentence}"`);
          
          if (!sentence || sentence.trim() === '') {
            this.logger.warn(`문장 ${index+1}은 비어있어 번역하지 않습니다.`);
            return {
              original: sentence,
              translated: '',
              success: false,
              error: '빈 문장'
            };
          }
          
          const result = await this.translator.translateText(
            sentence,
            deeplSourceLang,
            actualTargetLang,
            {
              preserveFormatting: true,
              formality: 'default'
            }
          );
          
          // 단일 텍스트 번역 결과
          const translation = Array.isArray(result) ? result[0] : result;
          
          this.logger.debug(`문장 ${index+1} 번역 성공: "${translation.text}"`);
          
          return {
            original: sentence,
            translated: translation.text,
            success: true
          };
        } catch (error) {
          this.logger.error(`문장 ${index+1} 번역 실패: ${error.message}`);
          return {
            original: sentence,
            translated: '',
            success: false,
            error: error.message
          };
        }
      });
      
      // 모든 번역 작업 완료 대기
      const translatedSentences = await Promise.all(translationPromises);
      
      // 번역 결과 분석
      const successCount = translatedSentences.filter(s => s.success).length;
      const failCount = translatedSentences.length - successCount;
      
      this.logger.log(`번역 결과 분석: 총 ${translatedSentences.length}개 중 성공 ${successCount}개, 실패 ${failCount}개`);
      
      // 모든 번역이 실패한 경우 대안으로 전체 텍스트를 한 번에 번역 시도
      if (successCount === 0 && sentences.length > 0) {
        this.logger.warn('모든 문장 번역 실패. 전체 텍스트를 단일 요청으로 번역 시도합니다.');
        try {
          const fallbackResult = await this.translator.translateText(
            cleanedText,
            deeplSourceLang, 
            actualTargetLang,
            {
              preserveFormatting: true,
              formality: 'default'
            }
          );
          
          const translation = Array.isArray(fallbackResult) ? fallbackResult[0] : fallbackResult;
          
          this.logger.log('전체 텍스트 단일 번역 성공');
          
          return {
            success: true,
            originalText: cleanedText,
            translatedText: translation.text,
            sentences: [{
              original: cleanedText,
              translated: translation.text,
              success: true
            }]
          };
        } catch (error) {
          this.logger.error(`전체 텍스트 단일 번역 실패: ${error.message}`);
        }
      }
      
      // 성공적으로 번역된 문장만 결합
      const successfulTranslations = translatedSentences
        .filter(s => s.success)
        .map(s => s.translated);
      
      const fullTranslatedText = successfulTranslations.join(' ');
      
      this.logger.log(`문장별 번역 완료: ${successfulTranslations.length}/${sentences.length} 문장 성공`);
      
      if (successfulTranslations.length > 0) {
        this.logger.debug(`번역 결과 샘플: "${fullTranslatedText.substring(0, 100)}${fullTranslatedText.length > 100 ? '...' : ''}"`);
      }
      
      return {
        success: successfulTranslations.length > 0,
        originalText: cleanedText,
        translatedText: fullTranslatedText,
        sentences: translatedSentences
      };
    } catch (error) {
      this.logger.error(`문장별 번역 오류: ${error.message}`);
      return {
        success: false,
        originalText: text,
        error: error.message
      };
    }
  }
} 