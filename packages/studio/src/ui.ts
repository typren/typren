"use client";

// `@typren/studio/ui`: the studio's primitives, for a host app (the cloud
// dashboard) that must look like the studio. They read `--typren-*` tokens, so
// load `@typren/studio/tokens.css` too.

export { Avatar } from "./primitives/avatar";
export { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "./primitives/alert-dialog";
export { Button, buttonVariants } from "./primitives/button";
export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./primitives/card";
export { cn } from "./primitives/cn";
export { useConfirm, type ConfirmOptions } from "./primitives/confirm";
export { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./primitives/context-menu";
export { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./primitives/dialog";
export { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyState, EmptyTitle } from "./primitives/empty";
export { CheckboxRow, Field } from "./primitives/field";
export { Input } from "./primitives/input";
export { Label } from "./primitives/label";
export { Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "./primitives/menu";
export { Popover, PopoverContent, PopoverTrigger } from "./primitives/popover";
export { ScrollArea, ScrollBar } from "./primitives/scroll-area";
export { SearchInput } from "./primitives/search-input";
export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./primitives/select";
export { Sheet, SheetContent, SheetTrigger } from "./primitives/sheet";
export { Loading, RowsSkeleton, Skeleton, TileGridSkeleton } from "./primitives/skeleton";
export { TopBarButton } from "./primitives/top-bar-button";
export { Textarea } from "./primitives/textarea";
export { ToggleGroup, ToggleGroupItem } from "./primitives/toggle-group";
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./primitives/tooltip";
