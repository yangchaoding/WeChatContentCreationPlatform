import { protocolPath, imageRequestSize, imageAddressMode, type ImageSettings } from '../shared/images';
import { AppError } from './workspace';

export type ImageSource = { url?: string; b64_json?: string };

export function protocolRequest(settings: Pick<ImageSettings, 'protocol' | 'model' | 'aspectRatio' | 'responseFormat'>, prompt: string): Record<string, unknown> {
  const size = imageRequestSize(settings.aspectRatio, settings.model);
  if (settings.protocol === 'responses') {
    // Responses is called natively. It is never translated into a chat request.
    // The tool chooses its supported canvas; the prompt specifies the target composition.
    return { model: settings.model, input: prompt, tools: [{ type: 'image_generation', size: 'auto', output_format: 'png' }], tool_choice: { type: 'image_generation' }, stream: false, store: false };
  }
  if (settings.protocol === 'chat') {
    // Image-capable Chat providers use the image modality extension; text-only replies are rejected.
    return { model: settings.model, messages: [{ role: 'user', content: prompt }], stream: false, modalities: ['text', 'image'], ...(settings.aspectRatio !== 'original' ? { image_config: { aspect_ratio: settings.aspectRatio } } : {}) };
  }
  return { model: settings.model, prompt, n: 1, ...(size ? { size } : {}), ...(settings.responseFormat !== 'auto' ? { response_format: settings.responseFormat } : {}) };
}

function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function imageUrl(value: unknown): ImageSource | undefined {
  if (typeof value !== 'string' || !value.trim()) return;
  const url = value.trim();
  const base64 = url.match(/^data:image\/[\w.+-]+;base64,([\s\S]+)$/i);
  return base64 ? { b64_json: base64[1] } : { url };
}
function imageBlock(value: unknown): ImageSource | undefined {
  const item = object(value);
  if (typeof item.b64_json === 'string' && item.b64_json) return { b64_json: item.b64_json };
  return imageUrl(object(item.image_url).url) || imageUrl(item.image_url) || imageUrl(item.url);
}
function markdownImage(value: unknown): ImageSource | undefined {
  if (typeof value !== 'string') return;
  // Only an explicit Markdown image is a result; ordinary prose links are not downloaded.
  const match = value.match(/!\[[^\]]*\]\(<?((?:https?:\/\/|data:image\/)[^\s)>]+)>?(?:\s+["'][^"']*["'])?\)/i);
  return match ? imageUrl(match[1]) : undefined;
}

export function protocolImage(payload: unknown, settings: Pick<ImageSettings, 'protocol'>): ImageSource {
  const root = object(payload);
  if (root.error || root.status === 'failed' || root.status === 'incomplete') throw new AppError(502, '渠道返回了失败或未完成的生成结果，请检查模型权限和渠道日志。', 'IMAGE_RESPONSE_FAILED');
  if (settings.protocol === 'responses') {
    for (const output of array(root.output)) {
      const item = object(output);
      if (item.type === 'image_generation_call' && typeof item.result === 'string' && item.result) return { b64_json: item.result };
      // Some native compatible providers return an output_image content block.
      for (const content of array(item.content)) {
        const block = object(content);
        if (block.type === 'output_image' || block.type === 'image_url') {
          const source = imageBlock(block);
          if (source) return source;
        }
      }
    }
    throw new AppError(502, 'Responses 未返回图片。请选择支持 image_generation 工具的调用模型，并确认渠道已开放该工具。', 'IMAGE_RESPONSE_MISSING');
  }
  if (settings.protocol === 'chat') {
    const message = object(object(array(root.choices)[0]).message);
    for (const image of array(message.images)) {
      const source = imageBlock(image);
      if (source) return source;
    }
    for (const content of array(message.content)) {
      const block = object(content);
      const source = block.type === 'image_url' || block.type === 'image' ? imageBlock(block) : block.type === 'text' ? markdownImage(block.text) : undefined;
      if (source) return source;
    }
    const source = markdownImage(message.content);
    if (source) return source;
    throw new AppError(502, 'Chat 未返回图片。请选择支持图片输出的模型和渠道；纯文本回复不能作为封面。', 'IMAGE_RESPONSE_MISSING');
  }
  const source = imageBlock(array(root.data)[0]);
  if (source) return source;
  throw new AppError(502, '响应中没有 data[0].url 或 data[0].b64_json 图片数据。', 'IMAGE_RESPONSE_MISSING');
}

export function inferredModelsAddress(settings: Pick<ImageSettings, 'address' | 'addressMode' | 'modelsAddress'>): string {
  if (settings.modelsAddress) return settings.modelsAddress;
  const url = new URL(settings.address);
  if (imageAddressMode(settings.address, settings.addressMode) === 'base') url.pathname = `${url.pathname.replace(/\/+$/, '')}/models`;
  else if (/\/(images\/generations|responses|chat\/completions)\/?$/.test(url.pathname)) url.pathname = url.pathname.replace(/\/(images\/generations|responses|chat\/completions)\/?$/, '/models');
  else throw new AppError(400, '无法从自定义接口推导模型地址，请填写“模型列表地址”。', 'MODEL_ADDRESS_REQUIRED');
  return url.href;
}

export function configuredEndpoint(settings: Pick<ImageSettings, 'address' | 'addressMode'> & Partial<Pick<ImageSettings, 'protocol'>>): string {
  const url = new URL(settings.address);
  if (imageAddressMode(settings.address, settings.addressMode) === 'base') url.pathname = `${url.pathname.replace(/\/+$/, '')}${protocolPath(settings.protocol || 'images')}`;
  return url.href;
}
