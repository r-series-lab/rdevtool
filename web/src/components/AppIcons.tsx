import { SvgIcon, type SvgIconProps } from "@mui/material";

export function RefreshIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M19 8.2A7.8 7.8 0 0 0 5.7 5.8L4.1 7.4V3H2v8.3h8.3V9.2H5.6l1.6-1.7a5.7 5.7 0 0 1 9.7 3.2H19ZM4.9 15.8a7.8 7.8 0 0 0 13.4 2.4l1.6-1.6V21H22v-8.3h-8.3v2.1h4.7l-1.6 1.7a5.7 5.7 0 0 1-9.7-3.2H4.9Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}

export function ReplayIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M12 4.5a7.5 7.5 0 0 1 7.4 6.2h2.1A9.6 9.6 0 0 0 5.9 5.6L4.1 7.4V3H2v8.3h8.3V9.2H5.6l1.8-1.8A6.5 6.5 0 0 1 12 4.5Z"
        fill="currentColor"
      />
      <path
        d="M9 8.2v7.6c0 .6.7 1 1.2.6l5.5-3.8a.75.75 0 0 0 0-1.2l-5.5-3.8c-.5-.4-1.2 0-1.2.6Z"
        fill="currentColor"
      />
      <path
        d="M4.6 13.3H2.5A9.6 9.6 0 0 0 18.1 18.4l1.8-1.8V21H22v-8.3h-8.3v2.1h4.7l-1.8 1.8A7.5 7.5 0 0 1 4.6 13.3Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}

export function WorkflowIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M7 5.2a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm10-1.7a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM7 14a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
        fill="currentColor"
      />
      <path
        d="M9.7 8.2h4.6v2H9.7v-2Zm0 8.3h2.6a4.8 4.8 0 0 0 4.7-4.7h2a6.8 6.8 0 0 1-6.7 6.7H9.7v-2Z"
        fill="currentColor"
        opacity=".62"
      />
    </SvgIcon>
  );
}

export function ActivityIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M4 13.2h3.2l1.9-6.7c.2-.7 1.2-.8 1.5-.1l3.1 9.1 1.6-4.2c.2-.4.6-.7 1.1-.7H20v2h-2.8l-2.4 6.2c-.3.7-1.2.7-1.5 0L10 9.2l-1.5 5.2c-.1.5-.6.8-1.1.8H4v-2Z"
        fill="currentColor"
      />
      <path
        d="M4.5 5.5h15v2h-15v-2Zm0 11h6.2l.7 2H4.5v-2Zm12.2 0h2.8v2h-3.6l.8-2Z"
        fill="currentColor"
        opacity=".38"
      />
    </SvgIcon>
  );
}

export function PanelBottomIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M6.8 5.8h10.4c1.5 0 2.6 1.1 2.6 2.6v7.2c0 1.5-1.1 2.6-2.6 2.6H6.8c-1.5 0-2.6-1.1-2.6-2.6V8.4c0-1.5 1.1-2.6 2.6-2.6Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M8.1 15.2h7.8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </SvgIcon>
  );
}

export function PanelSideIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M6.8 5.8h10.4c1.5 0 2.6 1.1 2.6 2.6v7.2c0 1.5-1.1 2.6-2.6 2.6H6.8c-1.5 0-2.6-1.1-2.6-2.6V8.4c0-1.5 1.1-2.6 2.6-2.6Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M14.5 8.3v7.4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </SvgIcon>
  );
}

export function TrashIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2.8 6h11.6l-.8 11H7L6.2 9Zm3.1 2 .4 7h1.8l-.3-7H9.3Zm3.5 0-.3 7h1.8l.4-7h-1.9Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}

export function CollapseIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="m12 7 7 7-1.5 1.5L12 10l-5.5 5.5L5 14l7-7Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}

export function ExpandIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="m12 17-7-7 1.5-1.5L12 14l5.5-5.5L19 10l-7 7Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}

export function ClearIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}

export function CheckIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="m9.8 15.2 7.1-8 1.6 1.4-8.5 9.6-4.6-4.7 1.5-1.5 2.9 3.2Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}

export function PlusIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}

export function EditIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M16.8 4.2a2.2 2.2 0 0 1 3.1 3.1l-9.8 9.8-4.2 1.1 1.1-4.2 9.8-9.8Zm-8 10.8-.4 1.5 1.5-.4 7.9-7.9-1.1-1.1L8.8 15Z"
        fill="currentColor"
      />
      <path
        d="M5 20h14v-2H5v2Z"
        fill="currentColor"
        opacity=".45"
      />
    </SvgIcon>
  );
}

export function StarIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="m12 3.4 2.5 5.1 5.6.8-4.1 4 1 5.6-5-2.6-5 2.6 1-5.6-4.1-4 5.6-.8L12 3.4Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}

export function MoreIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M6 10.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6Zm6 0a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6Zm6 0a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}

export function CopyIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M8 4h10a2 2 0 0 1 2 2v10h-2V6H8V4Zm-4 4h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4V8Zm2 2v8h8v-8H6Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}

export function UploadIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M12 4 6.6 9.4 8 10.8l3-3V16h2V7.8l3 3 1.4-1.4L12 4Z"
        fill="currentColor"
      />
      <path
        d="M5 18h14v2H5v-2Z"
        fill="currentColor"
        opacity=".54"
      />
    </SvgIcon>
  );
}

export function DownloadIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M11 4h2v8.2l3-3 1.4 1.4L12 16l-5.4-5.4L8 9.2l3 3V4Z"
        fill="currentColor"
      />
      <path
        d="M5 18h14v2H5v-2Z"
        fill="currentColor"
        opacity=".54"
      />
    </SvgIcon>
  );
}

export function PlayIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M7 5.8v12.4c0 .7.8 1.1 1.4.7l9-6.2a.9.9 0 0 0 0-1.4l-9-6.2c-.6-.4-1.4 0-1.4.7Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}

export function StopIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path d="M7.2 7.2h9.6v9.6H7.2z" fill="currentColor" />
    </SvgIcon>
  );
}

export function PackageIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M12 3.4 4.7 7.2v9.6l7.3 3.8 7.3-3.8V7.2L12 3.4Zm0 2.2 4.9 2.5-4.9 2.5-4.9-2.5L12 5.6Zm-5.4 4 4.4 2.3v5.5l-4.4-2.3V9.6Zm6.2 7.8v-5.5l4.4-2.3v5.5l-4.4 2.3Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}

export function FolderIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M4 6.5h5l1.5 1.8H20v8.7c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V6.5Z"
        fill="currentColor"
      />
      <path
        d="M4 8.2h16l-1.2 7.5a1.5 1.5 0 0 1-1.5 1.3H6.7a1.5 1.5 0 0 1-1.5-1.3L4 8.2Z"
        fill="currentColor"
        opacity=".24"
      />
    </SvgIcon>
  );
}

export function SettingsIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M10.8 3h2.4l.5 2.2c.5.2.9.4 1.3.7l2.1-.7 1.7 1.7-.8 2c.3.5.5.9.7 1.4l2.3.5v2.4l-2.3.5c-.2.5-.4.9-.7 1.4l.8 2-1.7 1.7-2.1-.7c-.4.3-.8.5-1.3.7l-.5 2.2h-2.4l-.5-2.2c-.5-.2-.9-.4-1.3-.7l-2.1.7-1.7-1.7.8-2c-.3-.5-.5-.9-.7-1.4L3 13.2v-2.4l2.3-.5c.2-.5.4-.9.7-1.4l-.8-2 1.7-1.7 2.1.7c.4-.3.8-.5 1.3-.7L10.8 3Zm1.2 6.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}

export function OpenExternalIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M13 5h6v6h-2V8.4l-6.8 6.8-1.4-1.4L15.6 7H13V5Z"
        fill="currentColor"
      />
      <path
        d="M6.5 6h4v2h-3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-3h2v4a2 2 0 0 1-2 2h-9A2 2 0 0 1 4.5 17V8a2 2 0 0 1 2-2Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}

export function LocateIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M11 3h2v3.1A6 6 0 0 1 17.9 11H21v2h-3.1A6 6 0 0 1 13 17.9V21h-2v-3.1A6 6 0 0 1 6.1 13H3v-2h3.1A6 6 0 0 1 11 6.1V3Zm1 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
        fill="currentColor"
      />
      <path d="M10 10h4v4h-4z" fill="currentColor" opacity=".38" />
    </SvgIcon>
  );
}

export function WebsiteIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-5.8 8A6.1 6.1 0 0 1 8 6.9c-.4 1.1-.7 2.5-.8 4.1h-1Zm0 2h1c.1 1.6.4 3 .8 4.1A6.1 6.1 0 0 1 6.2 13Zm4.8 5.4c-.8-1.1-1.4-3-1.6-5.4h3.2c-.2 2.4-.8 4.3-1.6 5.4Zm1.6-7.4H9.4c.2-2.4.8-4.3 1.6-5.4.8 1.1 1.4 3 1.6 5.4Zm3.4 6.1c.4-1.1.7-2.5.8-4.1h1a6.1 6.1 0 0 1-1.8 4.1Zm.8-6.1c-.1-1.6-.4-3-.8-4.1A6.1 6.1 0 0 1 17.8 11h-1Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}

export function TerminalIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M4.5 6.5h15a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Zm2.2 2.3L9.9 12l-3.2 3.2 1.1 1.1L12 12 7.8 7.7 6.7 8.8Zm6.6 5.7h4.4v-1.6h-4.4v1.6Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}

export function AppWindowIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path
        d="M5 6.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"
        fill="currentColor"
        opacity=".24"
      />
      <path
        d="M5 5h14a2 2 0 0 1 2 2v2H3V7a2 2 0 0 1 2-2Zm-1 5h16v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6Zm3 2.2h4.6v3.6H7v-3.6Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}
