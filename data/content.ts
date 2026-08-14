import {
  Archive,
  Brain,
  CalendarRange,
  CircleHelp,
  CloudOff,
  Compass,
  FileSearch,
  GitCompareArrows,
  History,
  Layers3,
  LibraryBig,
  Lightbulb,
  MessageSquarePlus,
  MessagesSquare,
  Network,
  NotebookPen,
  RefreshCw,
  SearchX,
  SlidersHorizontal,
  Sparkles,
  Telescope,
  TrendingUp,
  WandSparkles,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export type DiagramItem = {
  title: string;
  description: string;
  icon: LucideIcon;
};

export const problemGrowth: DiagramItem[] = [
  {
    title: "ChatGPTが高性能化",
    description: "複雑なテーマでも、深く考える相手になった",
    icon: Sparkles,
  },
  {
    title: "多分野で深い壁打ち",
    description: "制作・仕事・学習など、対話の範囲が広がった",
    icon: MessagesSquare,
  },
  {
    title: "気づきが大量に生まれる",
    description: "複数分野で、深い視点が大量かつ高速に生まれる",
    icon: Lightbulb,
  },
];

export const problemLosses: DiagramItem[] = [
  {
    title: "忘れる",
    description: "良い気づきも、次の対話に追われて薄れていく",
    icon: Brain,
  },
  {
    title: "どこに書いたか分からない",
    description: "チャットが増えるほど、必要な対話を探せない",
    icon: SearchX,
  },
  {
    title: "振り返れない",
    description: "過去の考えと今の変化を、後から並べて見られない",
    icon: History,
  },
  {
    title: "知見を取りこぼす",
    description: "他の対話とつながらず、次の思考に活かされない",
    icon: CloudOff,
  },
];

export const solutionSteps: DiagramItem[] = [
  {
    title: "複数チャットをまとめる",
    description: "テーマや期間をまたぐ対話を、一つの対象として扱う",
    icon: Layers3,
  },
  {
    title: "内容を比較する",
    description: "個別に読むだけでは見えない違いを並べる",
    icon: GitCompareArrows,
  },
  {
    title: "共通点や変化を見つける",
    description: "繰り返す関心や、考え方の移り変わりを捉える",
    icon: FileSearch,
  },
  {
    title: "新しい気づきを引き出す",
    description: "対話同士を掛け合わせ、新しい仮説へ変える",
    icon: Lightbulb,
  },
  {
    title: "次の問いにつなげる",
    description: "振り返りで終わらず、次に考える入口をつくる",
    icon: CircleHelp,
  },
];

export const mvpSteps: DiagramItem[] = [
  {
    title: "一連の対話（Session）を登録",
    description: "残したいChatGPTとの一連の壁打ちを取り込む",
    icon: MessageSquarePlus,
  },
  {
    title: "対象を選ぶ",
    description: "「今週分」など、振り返る範囲を決める",
    icon: CalendarRange,
  },
  {
    title: "AIが統合レビュー",
    description: "複数のSessionを横断して読み解く",
    icon: WandSparkles,
  },
];

export const mvpOutputs: DiagramItem[] = [
  { title: "要点", description: "何を話したか", icon: NotebookPen },
  { title: "共通テーマ", description: "何度も現れた関心", icon: Network },
  { title: "考えの変化", description: "以前と今の違い", icon: TrendingUp },
  { title: "新しい仮説", description: "統合して見えた可能性", icon: Telescope },
  { title: "次の問い", description: "次に深める論点", icon: Compass },
];

export const visionCore: DiagramItem[] = [
  {
    title: "Session",
    description: "日々の対話が蓄積される",
    icon: MessagesSquare,
  },
  {
    title: "Insight",
    description: "対話から気づきが抽出される",
    icon: Lightbulb,
  },
  {
    title: "Knowledge",
    description: "つながり、更新され、知識として育つ",
    icon: LibraryBig,
  },
];

export const visionFeatures: DiagramItem[] = [
  {
    title: "個人に合わせたレビュー",
    description: "関心や過去の思考を踏まえた振り返り",
    icon: Brain,
  },
  {
    title: "サブエージェント分析",
    description: "複数の専門視点から同じ対話を読み解く",
    icon: Workflow,
  },
  {
    title: "Obsidian連携",
    description: "既存ノートと知見をつなぎ、育てる",
    icon: Archive,
  },
  {
    title: "定期レビュー",
    description: "週次・月次で変化や未解決の問いを再発見",
    icon: RefreshCw,
  },
];

export const visionOptimization: DiagramItem = {
  title: "AI利用の個人最適化",
  description:
    "過去の対話・本人の評価・関心・特性をもとに、読む情報、レビュー方法、問いの出し方を、その人に合う形へ継続的にチューニングする",
  icon: SlidersHorizontal,
};
