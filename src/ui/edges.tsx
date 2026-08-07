import { memo, useRef } from 'react';
import { BaseEdge, getBezierPath, useReactFlow } from '@xyflow/react';
import type { Edge, EdgeProps } from '@xyflow/react';
import { useGraph } from '../store/useGraph';

/** 连线的曲线内分割点数据:mid 为分割点(flow 坐标)。
 *  它从属于曲线本身(不是节点):让一条贝塞尔曲线外观上分成两段(功能仍是一条连线,
 *  删除连线时两段与分割点一起消失),用于整理曲线避免杂乱。 */
export type CubicEdgeData = {
  mid?: { x: number; y: number };
};

/** 三次贝塞尔曲线连线(React Flow 标准 bezier)。
 *  若 edge.data.mid 存在,则渲染两段经过分割点的贝塞尔 + 可拖拽小圆点(调整曲线形状)。 */
export default memo(function CubicEdge(props: EdgeProps<Edge<CubicEdgeData>>) {
  const {
    id,
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    style,
    markerEnd,
    markerStart,
    interactionWidth,
    data,
  } = props;
  const mid = data?.mid;
  const { screenToFlowPosition } = useReactFlow();
  const updateEdgeData = useGraph((s) => s.updateEdgeData);
  // 拖拽状态:按住分割点并移动时更新 mid(仅当按下时跟随指针)
  const draggingRef = useRef(false);

  // 无分割点:单条标准贝塞尔;有分割点:source→mid 与 mid→target 两段
  let path1: string | null = null;
  let path2: string | null = null;
  if (mid) {
    const [p1] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX: mid.x,
      targetY: mid.y,
      targetPosition,
    });
    const [p2] = getBezierPath({
      sourceX: mid.x,
      sourceY: mid.y,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
    path1 = p1;
    path2 = p2;
  } else {
    const [p] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
    path1 = p;
  }

  // 拖拽分割点:实时更新 edge.data.mid,曲线外观随之调整
  const onMidPointerDown = (e: React.PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    draggingRef.current = true;
    // 捕获指针:快速拖动离开圆点后仍能继续跟踪,直到松开
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMidPointerMove = (e: React.PointerEvent<SVGCircleElement>) => {
    if (!draggingRef.current || !mid) return;
    e.stopPropagation();
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    updateEdgeData(id, { mid: { x: p.x, y: p.y } });
  };
  const onMidPointerUp = (e: React.PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    draggingRef.current = false;
  };

  return (
    <>
      {path1 && (
        <BaseEdge path={path1} style={style} markerStart={markerStart} interactionWidth={interactionWidth} />
      )}
      {path2 && (
        <BaseEdge path={path2} style={style} markerEnd={markerEnd} interactionWidth={interactionWidth} />
      )}
      {mid && (
        <>
          {/* 分割点拖拽命中区(透明大圆,便于抓取) */}
          <circle
            cx={mid.x}
            cy={mid.y}
            r={14}
            fill="transparent"
            style={{ cursor: 'grab', pointerEvents: 'all' }}
            onPointerDown={onMidPointerDown}
            onPointerMove={onMidPointerMove}
            onPointerUp={onMidPointerUp}
            onPointerLeave={onMidPointerUp}
          />
          {/* 可见小圆点(曲线内元素) */}
          <circle
            cx={mid.x}
            cy={mid.y}
            r={5.5}
            fill="#fff"
            stroke="#8b5cf6"
            strokeWidth={2}
            style={{ pointerEvents: 'none' }}
          />
        </>
      )}
    </>
  );
});
