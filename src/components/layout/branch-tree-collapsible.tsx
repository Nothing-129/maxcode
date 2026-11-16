"use client"

import { Fragment, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type { BranchTreeLeaf, BranchTreeNode } from "@/lib/branch-tree"

export type BranchTreeVariant = "dropdown" | "sidebar"

/**
 * Left padding (rem) for a branch row at `depth`. Owned here for group triggers
 * and exported so each selector's `renderLeaf` indents leaf rows identically.
 */
export function branchRowPaddingLeft(
  variant: BranchTreeVariant,
  depth: number
): string {
  const base = variant === "dropdown" ? 0.75 : 0.5
  const step = variant === "dropdown" ? 0.75 : 0.625
  return `${base + depth * step}rem`
}

const TRIGGER_CLASS: Record<BranchTreeVariant, string> = {
  dropdown:
    "flex w-full select-none items-center gap-2 rounded-xl py-2 pr-3 text-sm outline-hidden hover:bg-interaction-hover hover:text-foreground",
  sidebar:
    "flex w-full select-none items-center gap-2 rounded-lg py-1.5 pr-2 text-xs outline-hidden hover:bg-interaction-hover hover:text-foreground",
}

interface BranchTreeCollapsibleProps {
  nodes: BranchTreeNode[]
  depth: number
  expanded: Set<string>
  onToggle: (key: string) => void
  /** Renders a leaf row; receives the leaf object (with `fullName`) + its depth. */
  renderLeaf: (leaf: BranchTreeLeaf, depth: number) => ReactNode
  variant: BranchTreeVariant
}

/**
 * Recursive, fully-controlled renderer for a prefix-grouped branch tree. Owns
 * the collapsible group rows (plain-button triggers so Radix focus traversal in
 * `DropdownMenuContent` still works, with the chevron as a direct child so the
 * `[[data-state=open]>&]:rotate-90` arbitrary variant fires); leaf rendering is
 * delegated so each selector keeps its own leaf (dropdown sub-menu vs. button).
 */
export function BranchTreeCollapsible({
  nodes,
  depth,
  expanded,
  onToggle,
  renderLeaf,
  variant,
}: BranchTreeCollapsibleProps) {
  return (
    <>
      {nodes.map((node) => {
        if (node.type === "leaf") {
          return <Fragment key={node.key}>{renderLeaf(node, depth)}</Fragment>
        }
        return (
          <Collapsible
            key={node.key}
            open={expanded.has(node.key)}
            onOpenChange={() => onToggle(node.key)}
          >
            <CollapsibleTrigger
              className={TRIGGER_CLASS[variant]}
              style={{ paddingLeft: branchRowPaddingLeft(variant, depth) }}
            >
              <ChevronRight className="h-3 w-3 shrink-0 transition-transform [[data-state=open]>&]:rotate-90" />
              <span className="min-w-0 flex-1 truncate text-left">
                {node.label}
              </span>
              <span className="shrink-0 pl-2 text-xs text-muted-foreground/70">
                {node.count}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <BranchTreeCollapsible
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                renderLeaf={renderLeaf}
                variant={variant}
              />
            </CollapsibleContent>
          </Collapsible>
        )
      })}
    </>
  )
}
