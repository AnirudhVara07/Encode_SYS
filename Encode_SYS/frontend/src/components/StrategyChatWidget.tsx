import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Shield, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useVigilUser } from "@/context/VigilUserContext";
import { cn, stripMarkdownBoldForChat } from "@/lib/utils";

type ChatRole = "user" | "assistant";

type ChatTurn = { role: ChatRole; content: string };

type ChatSafety = { level: string; source: string };

const SAMPLE_QUESTIONS = [
  "How does majority voting work across my Paper Vigil strategies?",
  "Given my current autopilot settings, what tweaks are worth testing next?",
  "How is the historical backtest on /demo different from Paper Trading / Paper Vigil?",
  "What might my strategy profile suggest about trade frequency or sizing?",
  "What do the agent rules summary fields mean for when trades are blocked?",
];

export function StrategyChatWidget() {
  const { bearer } = useVigilUser();
  const loggedIn = Boolean(bearer.trim());
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [lastSafety, setLastSafety] = useState<ChatSafety | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<ChatTurn[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, open, loading]);

  const sendWithText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading || !loggedIn) return;
      const nextMessages: ChatTurn[] = [...messagesRef.current, { role: "user", content: trimmed }];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      setDraft("");
      setBanner(null);
      setLoading(true);
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const t = bearer.trim();
        if (t) headers.Authorization = `Bearer ${t}`;
        const r = await fetch("/api/strategy-chat", {
          method: "POST",
          headers,
          body: JSON.stringify({ messages: nextMessages }),
        });
        const d = (await r.json()) as {
          reply?: string;
          error?: string;
          personalized?: boolean;
          safety?: ChatSafety;
        };
        if (d.safety && typeof d.safety.level === "string" && typeof d.safety.source === "string") {
          setLastSafety(d.safety);
        }
        if (!r.ok) {
          setBanner(typeof d.error === "string" ? d.error : `Request failed (${r.status})`);
          return;
        }
        if (d.error) {
          setBanner(typeof d.error === "string" ? d.error : String(d.error));
          return;
        }
        const assistantTurn: ChatTurn = {
          role: "assistant",
          content: stripMarkdownBoldForChat(d.reply || "-"),
        };
        setMessages((prev) => {
          const out = [...prev, assistantTurn];
          messagesRef.current = out;
          return out;
        });
      } catch (e) {
        setBanner(e instanceof Error ? e.message : "Network error");
      } finally {
        setLoading(false);
      }
    },
    [bearer, loading, loggedIn],
  );

  const onSubmit = () => void sendWithText(draft);

  if (!loggedIn) return null;

  if (!open) {
    return (
      <div className="fixed bottom-5 right-5 z-50 sm:bottom-6 sm:right-6">
        <Button
          type="button"
          size="icon"
          className="h-12 w-12 rounded-full shadow-lg box-glow-green"
          onClick={() => setOpen(true)}
          aria-label="Open Chat to Vigil"
        >
          <MessageCircle className="h-5 w-5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[min(380px,calc(100vw-2.5rem))] sm:bottom-6 sm:right-6 sm:w-[min(380px,calc(100vw-3rem))]">
      <Card className="flex h-[min(70vh,560px)] max-h-[calc(100vh-5rem)] flex-col overflow-hidden rounded-xl border shadow-xl border-primary/20">
        <CardHeader className="shrink-0 border-b bg-card/95 py-3 px-4 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-base font-semibold">Chat to Vigil</CardTitle>
              {loggedIn ? (
                <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground leading-tight">
                  <Shield className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
                  <span>
                    {lastSafety == null
                      ? "Civic sign-in · screening runs on each message you send"
                      : lastSafety.source === "civic_bodyguard"
                        ? "Civic sign-in · Civic screening active on this chat"
                        : lastSafety.source === "local"
                          ? "Civic sign-in · automated screening on this chat"
                          : "Civic sign-in · assistant replies may be filtered for safety"}
                  </span>
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 h-8 w-8"
              onClick={() => setOpen(false)}
              aria-label="Close Chat to Vigil"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-0 p-0">
          {banner ? (
            <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-3 py-2">
              <p className="text-xs text-destructive font-mono leading-snug">{banner}</p>
            </div>
          ) : null}
          <div
            ref={scrollRef}
            className="strategy-chat-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3"
            aria-label="Conversation"
          >
            <div className="space-y-3">
              {messages.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Type a question below, or tap a suggested prompt.
                </p>
              ) : null}
              {messages.map((m, i) => (
                <div
                  key={`${i}-${m.role}`}
                  className={cn(
                    "rounded-lg px-3 py-2.5 text-sm leading-relaxed shadow-sm",
                    m.role === "user"
                      ? "ml-5 border border-primary/20 bg-primary/12 text-foreground"
                      : "mr-5 border border-border/80 bg-muted/70 text-foreground",
                  )}
                >
                  <div
                    className={cn(
                      "mb-1 text-[10px] uppercase tracking-wide text-muted-foreground",
                      m.role === "user" ? "font-medium" : "font-normal",
                    )}
                  >
                    {m.role === "user" ? "You" : "Assistant"}
                  </div>
                  <div
                    className={cn(
                      "whitespace-pre-wrap break-words",
                      m.role === "assistant" && "font-normal",
                    )}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {loading ? (
                <div className="mr-5 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground animate-pulse">
                  Thinking…
                </div>
              ) : null}
            </div>
          </div>
          <div className="shrink-0 space-y-2 border-t bg-card/95 px-3 pb-3 pt-2 backdrop-blur-sm">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Suggested prompts</p>
            <div className="-mx-0.5 flex gap-1.5 overflow-x-auto overflow-y-hidden pb-1 [scrollbar-width:thin]">
              {SAMPLE_QUESTIONS.map((q) => (
                <Button
                  key={q}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto shrink-0 max-w-[220px] whitespace-normal text-left text-[11px] leading-snug px-2.5 py-1.5"
                  disabled={loading}
                  onClick={() => void sendWithText(q)}
                >
                  {q}
                </Button>
              ))}
            </div>
            <div className="flex gap-2 items-end w-full min-w-0">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type your question… (Shift+Enter for newline)"
                rows={3}
                className="min-h-[5.5rem] max-h-32 min-w-0 flex-1 resize-y text-sm leading-normal"
                disabled={loading}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  const v = (e.target as HTMLTextAreaElement).value;
                  void sendWithText(v);
                }}
              />
              <Button
                type="button"
                size="icon"
                className="shrink-0 h-11 w-11"
                disabled={loading || !draft.trim()}
                onClick={onSubmit}
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
