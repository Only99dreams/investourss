import { useCallback, useEffect, useState } from "react";
import { Check, ChevronsUpDown, Loader2, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export interface PostAsMember {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

interface PostAsMemberPickerProps {
  /** The member the post will be published as, or null for the signed-in admin. */
  value: PostAsMember | null;
  onChange: (member: PostAsMember | null) => void;
  disabled?: boolean;
}

const memberName = (member: PostAsMember) =>
  member.full_name?.trim() || member.email?.trim() || "Unnamed member";

const initialsFor = (member: PostAsMember) => {
  const source = member.full_name?.trim() || member.email?.trim() || "?";
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
};

/**
 * Admin-only author picker for the community composer.
 *
 * Admins may publish a post on behalf of another member, so the post appears in
 * the feed under that member's name. Leaving it empty posts as the admin. The
 * database already allows this: the "Admins can manage all posts" RLS policy
 * covers INSERT for any author_id, so the UI only needs to choose the author.
 */
export function PostAsMemberPicker({ value, onChange, disabled }: PostAsMemberPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [members, setMembers] = useState<PostAsMember[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMembers = useCallback(async (query: string) => {
    setLoading(true);
    try {
      // Strip PostgREST filter syntax so a comma or bracket in a name cannot
      // break the OR expression.
      const safe = query.trim().replace(/[(),%*\\]/g, " ").trim();

      let request = supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url")
        .order("full_name", { ascending: true })
        .limit(20);

      if (safe) {
        request = request.or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%`);
      }

      const { data, error } = await request;
      if (error) throw error;
      setMembers((data ?? []) as PostAsMember[]);
    } catch (error) {
      console.error("Could not load members:", error);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // Debounce typing, but load the initial list immediately.
    const timer = window.setTimeout(() => void fetchMembers(search), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [open, search, fetchMembers]);

  return (
    <div className="space-y-1.5">
      <Label>Post as</Label>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className="flex min-w-0 items-center gap-2">
              {value ? (
                <Avatar className="h-5 w-5">
                  <AvatarImage src={value.avatar_url ?? undefined} alt="" />
                  <AvatarFallback className="text-[10px]">{initialsFor(value)}</AvatarFallback>
                </Avatar>
              ) : (
                <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{value ? memberName(value) : "Myself (admin)"}</span>
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(20rem,90vw)] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search members by name or email..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Searching...
                </div>
              ) : (
                <>
                  <CommandGroup>
                    <CommandItem
                      value="__myself__"
                      onSelect={() => {
                        onChange(null);
                        setOpen(false);
                      }}
                    >
                      <UserRound className="mr-2 h-4 w-4" />
                      <span>Myself (admin)</span>
                      <Check
                        className={cn(
                          "ml-auto h-4 w-4",
                          value ? "opacity-0" : "opacity-100",
                        )}
                      />
                    </CommandItem>
                  </CommandGroup>
                  <CommandGroup>
                    {members.length === 0 ? (
                      <div className="py-4 text-center text-sm text-muted-foreground">
                        No members found.
                      </div>
                    ) : (
                      members.map((member) => (
                        <CommandItem
                          key={member.id}
                          value={member.id}
                          onSelect={() => {
                            onChange(member);
                            setOpen(false);
                          }}
                        >
                          <Avatar className="mr-2 h-5 w-5">
                            <AvatarImage src={member.avatar_url ?? undefined} alt="" />
                            <AvatarFallback className="text-[10px]">
                              {initialsFor(member)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate">{memberName(member)}</span>
                          <Check
                            className={cn(
                              "ml-auto h-4 w-4",
                              value?.id === member.id ? "opacity-100" : "opacity-0",
                            )}
                          />
                        </CommandItem>
                      ))
                    )}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <p className="text-xs text-muted-foreground">
        Leave as yourself, or choose a member to publish this post under their name.
      </p>
    </div>
  );
}
