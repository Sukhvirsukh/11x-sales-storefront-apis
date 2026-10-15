/**
 * Copy of 11xsales-be's DEFAULT_CHAT_DESIGN
 * (src/services/chat-design/chat-design.defaults.ts). The dashboard saves
 * only the fields a merchant changed into `agents.widget_config`; both
 * services read them back over these defaults, so they MUST stay identical —
 * change both files together.
 */
export const DEFAULT_CHAT_DESIGN = {
  aiAgentName: 'Shopping assistant',
  chatFace: null as string | null,
  welcomeMessage: 'Hi! How can I help you today?',
  predefinedMessages: ['Track my order', "What's new?"],
  placeholderMessage: 'Ask me anything...',
  disclaimerMessage: 'This chat may be recorded to improve our service.',
  primaryColor: '#16181D',
  notificationColor: '#33D17A',
  chatBubbleType: 'type-bar',
  showOnMobile: true,
  showOnDesktopTablet: true,
  pageVisibility: 'all',
  excludePages: '/checkout',
  bubbleSize: 55,
  position: 'right',
  moveLeftRight: 20,
  moveUpDown: 20,
  zIndex: 999,
  connectWhatsApp: false,
  connectInstagram: false,
  leadStatus: 'dont-ask',
  leadTitle: '',
  leadSubtitle: '',
  sendButtonLabel: 'Send',
  emailPlaceholder: 'Enter your email',
  marketingConsent: 'ask-marketing',
  consentCheckboxDefault: 'pre-selected',
  marketingConsentText:
    'I agree to receive marketing emails, offers, promotions, and product updates. I understand that I can unsubscribe at any time.',
};

export type ChatDesign = typeof DEFAULT_CHAT_DESIGN;
export const CHAT_DESIGN_KEYS = Object.keys(DEFAULT_CHAT_DESIGN) as (keyof ChatDesign)[];

const str = { type: 'string' };
const bool = { type: 'boolean' };
const int = { type: 'integer' };

/** Response schema: exactly these fields go out, so other widget_config settings never leak. */
export const chatDesignResponseSchema = {
  type: 'object',
  properties: {
    aiAgentName: str,
    chatFace: { type: ['string', 'null'] },
    welcomeMessage: str,
    predefinedMessages: { type: 'array', items: str },
    placeholderMessage: str,
    disclaimerMessage: str,
    primaryColor: str,
    notificationColor: str,
    chatBubbleType: str,
    showOnMobile: bool,
    showOnDesktopTablet: bool,
    pageVisibility: str,
    excludePages: str,
    bubbleSize: int,
    position: str,
    moveLeftRight: int,
    moveUpDown: int,
    zIndex: int,
    connectWhatsApp: bool,
    connectInstagram: bool,
    leadStatus: str,
    leadTitle: str,
    leadSubtitle: str,
    sendButtonLabel: str,
    emailPlaceholder: str,
    marketingConsent: str,
    consentCheckboxDefault: str,
    marketingConsentText: str,
  },
} satisfies { properties: Record<keyof ChatDesign, unknown> } & Record<string, unknown>;
