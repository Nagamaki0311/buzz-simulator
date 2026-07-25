# fonts アセットについて

現時点ではGoogle Fonts CDN（Shippori Mincho / Noto Serif JP）を
style.css内の @import で読み込んでいます。
オフライン環境での動作やライセンス上の理由でフォントファイルを
同梱する必要がある場合は、このディレクトリにwoff2ファイルを配置し、
style.cssの@import部分を@font-faceに差し替えてください。
