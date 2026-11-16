import React from 'react';
import { RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  public state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected interruption occurred.',
    };
  }

  public componentDidCatch(error: Error): void {
    console.error('Sloww UI boundary caught error:', error);
  }

  public render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-[#F4ECE0] text-[#2B2118] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-[#FBF6EC] border border-[#DDD1BD] rounded-lg p-6 space-y-4 shadow-sm">
          <h1 className="font-display text-xl font-medium text-[#2B2118]">
            A brief pause in your sanctuary
          </h1>
          <p className="text-xs leading-relaxed text-[#635345]">
            Something unexpected interrupted this view. Your saved maps and thoughts remain safe in your account.
          </p>
          <p className="text-[11px] font-mono-tabular text-[#8F472B] bg-[#F7E9E2] border border-[#DFB6A5] rounded px-3 py-2 break-words">
            {this.state.message}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-[#FBF6EC] bg-[#5F735D] rounded-md hover:bg-[#4E604C] transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reload Sanctuary</span>
          </button>
        </div>
      </div>
    );
  }
}
