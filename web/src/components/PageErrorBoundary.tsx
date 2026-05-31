import { Component, type ReactNode } from "react";
import { Alert } from "@mui/material";

type PageErrorBoundaryProps = {
  children: ReactNode;
  resetKey?: string;
};

type PageErrorBoundaryState = {
  errorMessage: string;
};

export class PageErrorBoundary extends Component<
  PageErrorBoundaryProps,
  PageErrorBoundaryState
> {
  override state: PageErrorBoundaryState = {
    errorMessage: "",
  };

  static getDerivedStateFromError(error: unknown): PageErrorBoundaryState {
    return {
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  override componentDidCatch(error: unknown, info: { componentStack: string }) {
    console.error("[page-error-boundary]", error, info.componentStack);
  }

  override componentDidUpdate(prevProps: Readonly<PageErrorBoundaryProps>) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.errorMessage) {
      this.setState({ errorMessage: "" });
    }
  }

  override render() {
    if (this.state.errorMessage) {
      return <Alert severity="error">页面渲染失败：{this.state.errorMessage}</Alert>;
    }

    return this.props.children;
  }
}
