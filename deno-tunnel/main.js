// 目标 Vercel 地址 (根据你的实际地址修改)
const targetUrl = 'https://underrobot.vercel.app/';

async function handler(request) {
  const url = new URL(request.url);
  const path = url.pathname + url.search;
  const newUrl = targetUrl + path;

  // 1. 处理 CORS 预检请求 (OPTIONS 方法)
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  try {
    // 2. 构造并发送新的请求
    const modifiedRequest = new Request(newUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined,
    });

    const response = await fetch(modifiedRequest);

    // 3. 为真实响应添加 CORS 头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    return new Response(response.body, {
      status: response.status,
      headers: { ...response.headers, ...corsHeaders }
    });
  } catch (error) {
    return new Response('请求失败: ' + error.message, { status: 500 });
  }
}

Deno.serve(handler);