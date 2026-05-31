require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { extractTextFromPdf } = require('./src/pdfProcessor');
const { extractInvoiceInfo } = require('./src/deepseekClient');
const { generateWord } = require('./src/wordGenerator');

const app = express();
const PORT = process.env.PORT || 3000;

// 确保上传目录存在
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 配置multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('只支持PDF文件'));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', deepseekConfigured: !!process.env.DEEPSEEK_API_KEY });
});

// 识别单张PDF
app.post('/api/recognize', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传PDF文件' });
    }

    console.log('收到PDF:', req.file.originalname, '路径:', req.file.path);

    // 1. 提取PDF文字
    const rawText = await extractTextFromPdf(req.file.path);
    console.log('提取文字长度:', rawText.length);
    console.log('文字预览:', rawText.substring(0, 200));

    // 2. 调用DeepSeek结构化提取
    const invoiceInfo = await extractInvoiceInfo(rawText);
    console.log('识别结果:', JSON.stringify(invoiceInfo));

    // 3. 清理上传的临时文件
    try { fs.unlinkSync(req.file.path); } catch (e) {}

    res.json({
      success: true,
      filename: req.file.originalname,
      rawText: rawText.substring(0, 500), // 返回前500字符供参考
      data: invoiceInfo
    });
  } catch (error) {
    console.error('识别失败:', error);
    // 清理临时文件
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    res.status(500).json({ error: error.message || '识别失败' });
  }
});

// 生成Word文档
app.post('/api/generate-word', async (req, res) => {
  try {
    const { invoices } = req.body;

    if (!Array.isArray(invoices) || invoices.length === 0) {
      return res.status(400).json({ error: '请提供至少一张发票数据' });
    }

    console.log('生成Word，发票数量:', invoices.length);

    // 生成Word文件
    const docBuffer = generateWord(invoices);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const filename = encodeURIComponent('报销说明.docx');
    res.setHeader('Content-Disposition', `attachment; filename="report.docx"; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Length', docBuffer.length);
    res.send(docBuffer);
  } catch (error) {
    console.error('生成Word失败:', error);
    res.status(500).json({ error: error.message || '生成Word失败' });
  }
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `文件上传错误: ${err.message}` });
  }
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================`);
  console.log(`小票报销Word生成工具已启动`);
  console.log(`本机访问: http://localhost:${PORT}`);
  console.log(`局域网访问: http://0.0.0.0:${PORT} (同事可通过你的IP访问)`);
  console.log(`=================================`);

  if (!process.env.DEEPSEEK_API_KEY) {
    console.log('');
    console.log('⚠️  警告: 未检测到 DEEPSEEK_API_KEY');
    console.log('   请在项目根目录创建 .env 文件并添加:');
    console.log('   DEEPSEEK_API_KEY=sk-xxxxxxxxxx');
    console.log('');
  }
});
