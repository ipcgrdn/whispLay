/**
 * 텍스트를 문장 단위로 분리하는 유틸리티 함수
 */
import * as sentenceSplitter from 'sentence-splitter';

// 최소/최대 문장 길이 설정
const MIN_SENTENCE_LENGTH = 15; // 최소 문장 길이
const MAX_SENTENCE_LENGTH = 150; // 최대 문장 길이

/**
 * 텍스트를 문장 단위로 분리
 * @param text 분리할 텍스트
 * @returns 문장 배열
 */
export function splitIntoSentences(text: string): string[] {
  if (!text || text.trim() === '') {
    return [];
  }

  // 입력 텍스트 정리
  const cleanedText = cleanText(text);
  
  // sentence-splitter를 사용하여 기본 문장 분리
  const splitResult = sentenceSplitter.split(cleanedText);
  
  // 문장 노드만 추출
  const sentenceNodes = splitResult.filter(node => node.type === 'Sentence');
  
  // 각 문장의 원본 텍스트 추출
  let sentences = sentenceNodes.map(node => node.raw.trim());
  
  // 추가 처리: 긴 문장 분할, 짧은 문장 병합
  return processAndOptimizeSentences(sentences);
}

/**
 * 문장 배열을 최적화 (긴 문장 분할, 짧은 문장 병합)
 * @param sentences 기본 분리된 문장 배열
 * @returns 최적화된 문장 배열
 */
function processAndOptimizeSentences(sentences: string[]): string[] {
  if (!sentences || sentences.length === 0) {
    return [];
  }
  
  // 1단계: 긴 문장 추가 분할
  const splitLongSentences: string[] = [];
  
  for (const sentence of sentences) {
    if (sentence.length > MAX_SENTENCE_LENGTH) {
      // 긴 문장은 추가 분할 (쉼표, 접속사 등 기준)
      const subParts = sentence.split(/(?<=[,;:])\s+|(?<=\s(and|or|but|however|therefore|thus|moreover|furthermore|nevertheless|regardless|consequently))\s+/gi)
        .map(s => s.trim())
        .filter(s => s.length > 0);
      
      splitLongSentences.push(...subParts);
    } else {
      splitLongSentences.push(sentence);
    }
  }
  
  // 2단계: 너무 짧은 문장 병합
  const finalSentences: string[] = [];
  let tempSentence = '';
  
  for (const sentence of splitLongSentences) {
    if (sentence.length < MIN_SENTENCE_LENGTH && !isCompleteSentence(sentence)) {
      // 짧은 불완전한 문장은 임시 저장
      tempSentence += (tempSentence ? ' ' : '') + sentence;
    } else if (tempSentence) {
      // 이전에 저장된 짧은 문장이 있으면 현재 문장과 병합
      const combinedSentence = tempSentence + ' ' + sentence;
      
      // 조합된 문장도 너무 길다면 분리해서 추가
      if (combinedSentence.length > MAX_SENTENCE_LENGTH) {
        finalSentences.push(tempSentence);
        finalSentences.push(sentence);
      } else {
        finalSentences.push(combinedSentence);
      }
      
      tempSentence = '';
    } else {
      finalSentences.push(sentence);
    }
  }
  
  // 남은 임시 문장 처리
  if (tempSentence) {
    finalSentences.push(tempSentence);
  }
  
  // 빈 문장 제거 및 최종 정리
  return finalSentences
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * 텍스트에서 불필요한 공백, 특수문자 등을 정리
 * @param text 정리할 텍스트
 * @returns 정리된 텍스트
 */
export function cleanText(text: string): string {
  if (!text) return '';
  
  // 연속된 공백을 하나로 치환
  let cleanedText = text.replace(/\s+/g, ' ');
  
  // 앞뒤 공백 제거
  cleanedText = cleanedText.trim();
  
  return cleanedText;
}

/**
 * 최근 문장이 완결된 문장인지 확인
 * @param text 확인할 텍스트
 * @returns 완결된 문장인지 여부
 */
export function isCompleteSentence(text: string): boolean {
  if (!text || text.trim() === '') {
    return false;
  }
  
  // 문장 끝에 구두점이 있는지 확인
  return /[.!?]$/.test(text.trim());
}

/**
 * 주어진 텍스트에서 언어를 감지 (간단 구현)
 * @param text 검사할 텍스트
 * @returns 감지된 언어 코드 (ko, en, ja, zh 등)
 */
export function detectLanguageHint(text: string): string | null {
  if (!text || text.trim().length < 3) {
    return null;
  }
  
  // 한글 비율 확인 (간단한 휴리스틱)
  const koreanChars = text.match(/[ㄱ-ㅎㅏ-ㅣ가-힣]/g) || [];
  const koreanRatio = koreanChars.length / text.length;
  
  if (koreanRatio > 0.5) {
    return 'ko';
  }
  
  // 일본어 감지 (히라가나, 가타카나)
  const japaneseChars = text.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || [];
  const japaneseRatio = japaneseChars.length / text.length;
  
  if (japaneseRatio > 0.3) {
    return 'ja';
  }
  
  // 중국어 감지 (한자)
  const chineseChars = text.match(/[\u4E00-\u9FFF]/g) || [];
  const chineseRatio = chineseChars.length / text.length;
  
  if (chineseRatio > 0.3) {
    return 'zh';
  }
  
  // 기본값은 영어 (단순화)
  return 'en';
} 