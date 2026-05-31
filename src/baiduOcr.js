require('dotenv').config();
const axios = require('axios');

const API_KEY = process.env.BAIDU_OCR_API_KEY;
const SECRET_KEY = process.env.BAIDU_OCR_SECRET_KEY;

const TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const OCR_URL = 'https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic';

let tokenCache = {
  accessToken: null,
  expiresAt: 0
};

/**
 * 获取百度OCR access_token（带缓存）
 */
async function getAccessToken() {
  // 缓存有效期内直接返回
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 60000) {
    return tokenCache.accessToken;
  }

  if (!API_KEY || !SECRET_KEY) {
    throw new Error('未配置 BAIDU_OCR_API_KEY 或 BAIDU_OCR_SECRET_KEY，请在 .env 文件中设置');
  }

  try {
    const res = await axios.post(
      `${TOKEN_URL}?grant_type=client_credentials&client_id=${API_KEY}&client_secret=${SECRET_KEY}`,
      null,
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (res.data.error) {
      throw new Error(`百度OCR获取token失败: ${res.data.error_description || res.data.error}`);
    }

    tokenCache.accessToken = res.data.access_token;
    // 提前5分钟过期，避免边界问题
    tokenCache.expiresAt = Date.now() + (res.data.expires_in - 300) * 1000;

    console.log('百度OCR token获取成功');
    return tokenCache.accessToken;
  } catch (err) {
    console.error('百度OCR token获取失败:', err.message);
    throw new Error(`百度OCR认证失败: ${err.message}`);
  }
}

/**
 * 延时函数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 对单张图片进行OCR识别（带重试，处理QPS限流）
 * @param {Buffer} imageBuffer - 图片Buffer
 * @returns {Promise<string>} 识别出的文字
 */
async function recognizeImage(imageBuffer) {
  const accessToken = await getAccessToken();
  const base64Image = imageBuffer.toString('base64');

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios.post(
        `${OCR_URL}?access_token=${accessToken}`,
        `image=${encodeURIComponent(base64Image)}&detect_direction=true`,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 30000
        }
      );

      if (res.data.error_code) {
        // QPS限流 (error_code: 18)，等待后重试
        if (res.data.error_code === 18 && attempt < maxRetries) {
          console.log(`    百度OCR QPS限流，${attempt}秒后重试...`);
          await sleep(attempt * 1000);
          continue;
        }
        throw new Error(`百度OCR识别失败: [${res.data.error_code}] ${res.data.error_msg}`);
      }

      const results = res.data.words_result || [];
      const text = results.map(item => item.words).join('\n');

      console.log(`    百度OCR识别完成: ${results.length} 个文字块, 总长度 ${text.length}`);
      return text;
    } catch (err) {
      if (attempt === maxRetries) {
        console.error('百度OCR请求失败:', err.message);
        throw new Error(`百度OCR识别失败: ${err.message}`);
      }
      // 其他错误也等待后重试
      console.log(`    百度OCR请求失败，${attempt}秒后重试...`);
      await sleep(attempt * 1000);
    }
  }
}

/**
 * 批量识别多张图片
 * @param {Array<Buffer>} imageBuffers - 图片Buffer数组
 * @returns {Promise<string>} 合并后的文字
 */
async function recognizeImages(imageBuffers) {
  let fullText = '';
  for (let i = 0; i < imageBuffers.length; i++) {
    console.log(`  百度OCR识别第 ${i + 1}/${imageBuffers.length} 页...`);
    const pageText = await recognizeImage(imageBuffers[i]);
    fullText += pageText + '\n';
  }
  return fullText.trim();
}

module.exports = { recognizeImage, recognizeImages };
