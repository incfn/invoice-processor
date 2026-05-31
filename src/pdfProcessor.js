const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { pdf } = require('pdf-to-img');

// 优先使用百度OCR，未配置则回退到本地tesseract.js
let baiduOcr;
try {
  baiduOcr = require('./baiduOcr');
} catch (e) {
  baiduOcr = null;
}

// 本地OCR（tesseract.js）回退方案
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

function countChineseChars(text) {
  const matches = text.match(/[一-龥]/g);
  return matches ? matches.length : 0;
}

async function recognizeWithAutoRotate(worker, imageBuffer) {
  const angles = [0, 90, 180, 270];
  let bestResult = '';
  let bestScore = -1;
  let bestAngle = 0;

  for (const angle of angles) {
    let rotatedBuffer;
    if (angle === 0) {
      rotatedBuffer = imageBuffer;
    } else {
      rotatedBuffer = await sharp(imageBuffer).rotate(angle).png().toBuffer();
    }

    const { data: { text } } = await worker.recognize(rotatedBuffer);
    const trimmed = text.trim();
    const score = countChineseChars(trimmed);

    if (score > bestScore) {
      bestScore = score;
      bestResult = trimmed;
      bestAngle = angle;
    }

    if (score >= 50) {
      console.log(`    本地OCR: 提前选择方向 ${angle}° (中文字符数充足)`);
      return bestResult;
    }
  }

  console.log(`    本地OCR: 选择方向 ${bestAngle}° (中文字符数: ${bestScore})`);
  return bestResult;
}

async function extractTextFromPdf(pdfPath) {
  // 第一步：尝试用 pdf-parse 提取内嵌文字
  try {
    const buffer = fs.readFileSync(pdfPath);
    const parsed = await pdfParse(buffer);

    if (parsed.text && parsed.text.trim().length > 50) {
      console.log(`PDF ${path.basename(pdfPath)} 提取到内嵌文字，长度:`, parsed.text.trim().length);
      return parsed.text.trim();
    }
  } catch (err) {
    console.warn('pdf-parse 提取失败:', err.message);
  }

  // 第二步：PDF是图片型，优先使用百度OCR，未配置则回退到本地OCR
  const hasBaiduKey = !!process.env.BAIDU_OCR_API_KEY && !!process.env.BAIDU_OCR_SECRET_KEY;

  if (hasBaiduKey && baiduOcr) {
    console.log(`PDF ${path.basename(pdfPath)} 无内嵌文字，使用百度OCR识别...`);
    try {
      return await extractTextWithBaiduOcr(pdfPath);
    } catch (err) {
      console.warn('百度OCR失败，回退到本地OCR:', err.message);
    }
  }

  console.log(`PDF ${path.basename(pdfPath)} 使用本地OCR识别...`);
  return await extractTextWithLocalOcr(pdfPath);
}

/**
 * 用本地OCR快速检测最佳旋转角度
 */
async function detectBestRotation(worker, imageBuffer) {
  const angles = [0, 90, 180, 270];
  let bestAngle = 0;
  let bestScore = -1;

  for (const angle of angles) {
    let rotatedBuffer;
    if (angle === 0) {
      rotatedBuffer = imageBuffer;
    } else {
      rotatedBuffer = await sharp(imageBuffer).rotate(angle).png().toBuffer();
    }

    const { data: { text } } = await worker.recognize(rotatedBuffer);
    const score = countChineseChars(text.trim());

    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }

    if (score >= 30) {
      break; // 方向已确定
    }
  }

  console.log(`    本地OCR检测最佳方向: ${bestAngle}° (中文字符数: ${bestScore})`);
  return bestAngle;
}

async function extractTextWithBaiduOcr(pdfPath) {
  const document = await pdf(pdfPath, { scale: 2.0 });
  const images = [];
  for await (const image of document) {
    images.push(image);
  }

  if (images.length === 0) {
    throw new Error('PDF转图片失败，未生成图片');
  }

  console.log(`PDF 共 ${images.length} 页，先用本地OCR检测方向，再用百度OCR高精度识别...`);

  // 用本地OCR检测每张图片的最佳方向
  const worker = await createWorker('chi_sim+eng');
  const rotatedImages = [];

  for (let i = 0; i < images.length; i++) {
    const bestAngle = await detectBestRotation(worker, images[i]);
    if (bestAngle !== 0) {
      const rotated = await sharp(images[i]).rotate(bestAngle).png().toBuffer();
      rotatedImages.push(rotated);
    } else {
      rotatedImages.push(images[i]);
    }
  }

  await worker.terminate();

  // 用百度OCR识别旋转校正后的图片
  console.log(`  调用百度OCR识别...`);
  const fullText = await baiduOcr.recognizeImages(rotatedImages);

  // 质量检查：如果百度OCR结果中文太少，回退到本地OCR
  const chineseCount = countChineseChars(fullText);
  if (chineseCount < 20) {
    console.warn(`    百度OCR结果质量差(中文字符数:${chineseCount})，回退到本地OCR`);
    throw new Error('百度OCR结果质量不足');
  }

  console.log(`百度OCR完成，提取文字长度:`, fullText.length);
  return fullText;
}

async function extractTextWithLocalOcr(pdfPath) {
  const document = await pdf(pdfPath, { scale: 2.0 });
  const images = [];
  for await (const image of document) {
    images.push(image);
  }

  if (images.length === 0) {
    throw new Error('PDF转图片失败，未生成图片');
  }

  console.log(`PDF 共 ${images.length} 页，开始本地OCR识别（自动校正旋转）...`);

  const worker = await createWorker('chi_sim+eng');
  let fullText = '';

  for (let i = 0; i < images.length; i++) {
    console.log(`  识别第 ${i + 1}/${images.length} 页...`);
    const pageText = await recognizeWithAutoRotate(worker, images[i]);
    fullText += pageText + '\n';
  }

  await worker.terminate();
  console.log(`本地OCR完成，提取文字长度:`, fullText.trim().length);
  return fullText.trim();
}

module.exports = { extractTextFromPdf };
