import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useKeyboardNavigationContext } from '../../contexts/keyboard-navigation-context'
import { useKeyboardNavigation } from '../../hooks/use-keyboard-navigation'
import { useAppLayout } from '../../app'

interface ArticleZapNavigationProps {
  currentArticleId: string
}

export function ArticleZapNavigation({ currentArticleId }: ArticleZapNavigationProps) {
  const navigate = useNavigate()
  const { articleIds, articleUrls, setFocusedItemId, navigateToArticle } = useKeyboardNavigationContext()
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
          // In overlay mode, we still want the ArticleList's handler if possible,
          // but we can also fallback to a direct state update if we were to move
          // overlayUrl to context (not doing that yet to avoid complexity).
          navigateToArticle(id)
        } else {
          const urlWithoutProtocol = url.replace(/^https?:\/\//, '')
          void navigate(`/${encodeURIComponent(urlWithoutProtocol)}`)
        }
      } else {
        // Fallback to the registered handler
        navigateToArticle(id)
      }
    },
    enabled: keyboardNavigation === 'on' && articleIds.length > 0,
    keyBindings: keybindings,
  })

  // Set focused item on mount so j/k knows where we are
  useEffect(() => {
    setFocusedItemId(currentArticleId)
  }, [currentArticleId, setFocusedItemId])

  return null
}
