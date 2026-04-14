import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useKeyboardNavigationContext } from '../../contexts/keyboard-navigation-context'
import { useKeyboardNavigation } from '../../hooks/use-keyboard-navigation'
import { useAppLayout } from '../../app'

interface ArticleZapNavigationProps {
  currentArticleId: string
  onBookmarkToggle?: () => void
  onOpenExternal?: () => void
}

export function ArticleZapNavigation({ currentArticleId, onBookmarkToggle, onOpenExternal }: ArticleZapNavigationProps) {
  const navigate = useNavigate()
  const { articleIds, articleUrls, setFocusedItemId, navigateToArticle, lastListUrl } = useKeyboardNavigationContext()
  const { settings: { keyboardNavigation, keybindings, articleOpenMode } } = useAppLayout()

  const isOverlayMode = articleOpenMode === 'overlay'

  useKeyboardNavigation({
    items: articleIds,
    focusedItemId: currentArticleId,
    onFocusChange: (id) => {
      setFocusedItemId(id)
      
      // If we have the URL in our persisted map, use it to navigate
      const url = articleUrls[id]
      if (url) {
        if (isOverlayMode) {
          navigateToArticle(id)
        } else {
          const urlWithoutProtocol = url.replace(/^https?:\/\//, '')
          void navigate(`/${encodeURIComponent(urlWithoutProtocol)}`)
        }
      } else {
        navigateToArticle(id)
      }
    },
    onBookmarkToggle: onBookmarkToggle ? () => onBookmarkToggle() : undefined,
    onOpenExternal: onOpenExternal ? () => onOpenExternal() : undefined,
    onEscape: () => {
      if (!isOverlayMode) {
        void navigate(lastListUrl || '/inbox')
      }
    },
    enabled: keyboardNavigation === 'on' && articleIds.length > 0,
    keyBindings: keybindings,
  })

  useEffect(() => {
    setFocusedItemId(currentArticleId)
  }, [currentArticleId, setFocusedItemId])

  return null
}
