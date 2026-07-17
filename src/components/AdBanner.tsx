import React from 'react';

export function AdBanner() {
  // Create an isolated HTML structure inside the iframe to execute the script perfectly
  const iframeSrcDoc = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body {
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            background-color: transparent;
            overflow: hidden;
          }
        </style>
      </head>
      <body>
        <script type="text/javascript">
          atOptions = {
            'key' : 'dbe2cf2c19b83a99d8d6593a3ea35aa5',
            'format' : 'iframe',
            'height' : 600,
            'width' : 160,
            'params' : {}
          };
        </script>
        <script type="text/javascript" src="https://www.highperformanceformat.com/dbe2cf2c19b83a99d8d6593a3ea35aa5/invoke.js"></script>
      </body>
    </html>
  `;

  return (
    <div className="w-full flex flex-col items-center justify-center p-4 bg-slate-900/40 border border-slate-800/80 rounded-xl mb-6 max-w-full overflow-hidden">
      <span className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2">Sponsored Ad</span>
      <div className="flex justify-center items-center w-full overflow-auto">
        <iframe
          title="Sponsored Ad 160x600"
          srcDoc={iframeSrcDoc}
          width="160"
          height="600"
          style={{ border: 'none', overflow: 'hidden' }}
          className="bg-slate-950/40 border border-slate-800/50 rounded shadow-inner"
          scrolling="no"
        />
      </div>
    </div>
  );
}

