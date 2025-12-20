from typing import List, Tuple
from collections import namedtuple

Point = namedtuple('Point', ['x', 'y'])

def side(p1: Point, p2: Point, p: Point) -> float:
    """Returns the side of point p relative to line p1-p2.
    Positive value: one side, Negative value: other side, 0: on the line.
    Uses the cross product of (p2-p1) and (p-p1).
    """
    return (p2.x - p1.x) * (p.y - p1.y) - (p2.y - p1.y) * (p.x - p1.x)

def intersect(p1: Point, p2: Point, a: Point, b: Point) -> Point:
    """Returns the intersection point of line p1-p2 and segment a-b."""
    s_a = side(p1, p2, a)
    s_b = side(p1, p2, b)
    
    # Avoid division by zero if s_a == s_b (shouldn't happen if they are on opposite sides)
    denom = s_a - s_b
    if abs(denom) < 1e-12:
        return a
        
    t = s_a / denom
    return Point(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y))

def split_convex_polygon(poly: List[Point], lp1: Point, lp2: Point) -> Tuple[List[Point], List[Point]]:
    """Splits a convex polygon (ordered CW) by a line defined by lp1 and lp2.
    Returns a tuple of two polygons (lists of Points).
    If the line doesn't split the polygon, one will be empty or contain the original polygon.
    """
    if len(poly) < 3:
        return poly, []

    left_poly = []
    right_poly = []
    
    n = len(poly)
    # Small epsilon for floating point comparisons
    EPS = 1e-9
    
    for i in range(n):
        curr = poly[i]
        next_p = poly[(i + 1) % n]
        
        s_curr = side(lp1, lp2, curr)
        s_next = side(lp1, lp2, next_p)
        
        # Add current point to the appropriate polygons
        if s_curr >= -EPS:
            left_poly.append(curr)
        if s_curr <= EPS:
            right_poly.append(curr)
            
        # Check for intersection with the line
        # If the edge crosses from one side to the other (not just touching)
        if (s_curr > EPS and s_next < -EPS) or (s_curr < -EPS and s_next > EPS):
            inter = intersect(lp1, lp2, curr, next_p)
            left_poly.append(inter)
            right_poly.append(inter)

    def clean(p_list):
        if not p_list:
            return []
        # Remove consecutive duplicate points
        cleaned = []
        for p in p_list:
            if not cleaned or (abs(p.x - cleaned[-1].x) > EPS or abs(p.y - cleaned[-1].y) > EPS):
                cleaned.append(p)
        # Check if last point is same as first
        if len(cleaned) > 1 and abs(cleaned[0].x - cleaned[-1].x) <= EPS and abs(cleaned[0].y - cleaned[-1].y) <= EPS:
            cleaned.pop()
        # A valid polygon must have at least 3 points
        return cleaned if len(cleaned) >= 3 else []

    return clean(left_poly), clean(right_poly)
