import { describe, expect, it } from 'vitest'
import { safeReferenceUrl } from './sourceUrl'

describe('reference URL boundary', () => {
  it('accepts absolute http(s) references without fetching them', () => {
    expect(safeReferenceUrl('https://example.org/book?chapter=1#water')).toBe('https://example.org/book?chapter=1#water')
    expect(safeReferenceUrl('http://example.org')).toBe('http://example.org/')
    expect(safeReferenceUrl('https://例子.测试/水')).toMatch(/^https:\/\//)
    expect(safeReferenceUrl('https://example.org?contact=a@b&query=one%20two')).toBe('https://example.org/?contact=a@b&query=one%20two')
  })

  it.each([
    '', 'javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', '//example.org/page', '/page', 'https:///example.org',
    'https://user:password@example.org', 'http://@example.org', 'https://example.org/a b', 'https://example.org/\npage',
    'https://example.org/\u0000page', 'https://example.org/\u200bpage', ' https://example.org', 'https://example.org\\@evil.test', 'https://',
    'https://host_name.example', 'https://example.org:0', 'https://example.org:99999', 'https://%65xample.org',
  ])('rejects unsafe or ambiguous reference %j', (value) => {
    expect(safeReferenceUrl(value)).toBeNull()
  })
})
