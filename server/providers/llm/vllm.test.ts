import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSetting, mockCreate } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockCreate: vi.fn(),
}))

vi.mock('../../db.js', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}))

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: (...args: unknown[]) => mockCreate(...args),
      },
    }
    constructor(public opts: any) {}
  },
}))

import { vllmProvider, getVllmBaseUrl, getVllmApiKey } from './vllm.js'

describe('vllmProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSetting.mockReset()
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'test response' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    })
    process.env.VLLM_BASE_URL = ''
  })

  it('gets base URL from settings', () => {
    mockGetSetting.mockReturnValue('http://vllm-server:8000')
    expect(getVllmBaseUrl()).toBe('http://vllm-server:8000')
  })

  it('gets base URL from env if setting is empty', () => {
    mockGetSetting.mockReturnValue(undefined)
    process.env.VLLM_BASE_URL = 'http://vllm-env:8000'
    expect(getVllmBaseUrl()).toBe('http://vllm-env:8000')
  })

  it('gets default base URL if both are empty', () => {
    mockGetSetting.mockReturnValue(undefined)
    process.env.VLLM_BASE_URL = ''
    expect(getVllmBaseUrl()).toBe('http://localhost:8000')
  })

  it('gets API key from settings', () => {
    mockGetSetting.mockImplementation((key) => {
      if (key === 'api_key.vllm') return 'vllm-key'
      return undefined
    })
    expect(getVllmApiKey()).toBe('vllm-key')
  })

  it('createMessage calls OpenAI with correct parameters', async () => {
    mockGetSetting.mockImplementation((key) => {
      if (key === 'vllm.base_url') return 'http://vllm:8000'
      if (key === 'api_key.vllm') return 'key'
      return undefined
    })

    const result = await vllmProvider.createMessage({
      model: 'test-model',
      maxTokens: 100,
      messages: [{ role: 'user', content: 'hello' }],
      systemInstruction: 'you are a bot',
    })

    expect(result.text).toBe('test response')
    expect(result.inputTokens).toBe(10)
    expect(result.outputTokens).toBe(20)
  })

  it('includes chat_template_kwargs when vllm.enable_reasoning is on', async () => {
    mockGetSetting.mockImplementation((key) => {
      if (key === 'vllm.base_url') return 'http://vllm:8000'
      if (key === 'api_key.vllm') return 'key'
      if (key === 'vllm.enable_reasoning') return 'on'
      return undefined
    })

    await vllmProvider.createMessage({
      model: 'test-model',
      maxTokens: 100,
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning_format: 'auto',
        chat_template_kwargs: {
          enable_thinking: true,
          thinking: true,
        },
      }),
    )
  })

  it('includes chat_template_kwargs when vllm.enable_reasoning is off', async () => {
    mockGetSetting.mockImplementation((key) => {
      if (key === 'vllm.base_url') return 'http://vllm:8000'
      if (key === 'api_key.vllm') return 'key'
      if (key === 'vllm.enable_reasoning') return 'off'
      return undefined
    })

    await vllmProvider.createMessage({
      model: 'test-model',
      maxTokens: 100,
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning_format: 'auto',
        chat_template_kwargs: {
          enable_thinking: false,
          thinking: false,
        },
      }),
    )
  })

  it('uses chat_template_kwargs with false when vllm.enable_reasoning is undefined', async () => {
    mockGetSetting.mockImplementation((key) => {
      if (key === 'vllm.base_url') return 'http://vllm:8000'
      if (key === 'api_key.vllm') return 'key'
      return undefined
    })

    await vllmProvider.createMessage({
      model: 'test-model',
      maxTokens: 100,
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_template_kwargs: {
          enable_thinking: false,
          thinking: false,
        },
      }),
    )
  })
})
