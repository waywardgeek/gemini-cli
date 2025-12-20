import unittest
from convex_split import Point, split_convex_polygon

class TestConvexSplit(unittest.TestCase):

    def setUp(self):
        # A simple square: (0,2), (2,2), (2,0), (0,0) - CW
        self.square = [
            Point(0, 2),
            Point(2, 2),
            Point(2, 0),
            Point(0, 0)
        ]

    def test_horizontal_split(self):
        # Line y = 1
        lp1 = Point(-1, 1)
        lp2 = Point(3, 1)
        p1, p2 = split_convex_polygon(self.square, lp1, lp2)
        
        # Expected p1: (0,2), (2,2), (2,1), (0,1)
        # Expected p2: (2,1), (2,0), (0,0), (0,1)
        self.assertEqual(len(p1), 4)
        self.assertEqual(len(p2), 4)
        
        # Check some coordinates
        self.assertIn(Point(0, 2), p1)
        self.assertIn(Point(2, 1), p1)
        self.assertIn(Point(2, 0), p2)
        self.assertIn(Point(0, 1), p2)

    def test_split_through_vertices(self):
        # Line from (0,2) to (2,0) - Diagonal
        lp1 = Point(0, 2)
        lp2 = Point(2, 0)
        p1, p2 = split_convex_polygon(self.square, lp1, lp2)
        
        # Expected p1: (0,2), (2,2), (2,0)
        # Expected p2: (0,2), (2,0), (0,0)
        self.assertEqual(len(p1), 3)
        self.assertEqual(len(p2), 3)
        self.assertIn(Point(2, 2), p1)
        self.assertIn(Point(0, 0), p2)

    def test_collinear_edge(self):
        # Line y = 2 (Top edge)
        lp1 = Point(-1, 2)
        lp2 = Point(3, 2)
        p1, p2 = split_convex_polygon(self.square, lp1, lp2)
        
        # Line is collinear with top edge.
        # One side should be the whole square, the other empty (or < 3 points)
        if not p1: p1, p2 = p2, p1 # Ensure p1 is the non-empty one
        
        self.assertEqual(len(p1), 4)
        self.assertEqual(len(p2), 0)

    def test_no_split_outside(self):
        # Line y = 3 (Above the square)
        lp1 = Point(-1, 3)
        lp2 = Point(3, 3)
        p1, p2 = split_convex_polygon(self.square, lp1, lp2)
        
        # One side should be the whole square, other empty
        if not p1: p1, p2 = p2, p1
        self.assertEqual(len(p1), 4)
        self.assertEqual(len(p2), 0)

    def test_touching_one_vertex(self):
        # Line through (0,2) but otherwise outside
        lp1 = Point(-1, 3)
        lp2 = Point(1, 1) # Line: y = -x + 2. Touches (0,2) and (2,0) actually.
        # Wait, let's pick a line that only touches (0,2)
        # Line: x + y = 2 passes through (0,2) and (2,0).
        # Line: y = 2x + 2 passes through (0,2). For x=2, y=6.
        lp1 = Point(0, 2)
        lp2 = Point(-1, 0)
        p1, p2 = split_convex_polygon(self.square, lp1, lp2)
        
        if not p1: p1, p2 = p2, p1
        self.assertEqual(len(p1), 4)
        self.assertEqual(len(p2), 0)

    def test_degenerate_polygon(self):
        poly = [Point(0,0), Point(1,1)]
        p1, p2 = split_convex_polygon(poly, Point(0,1), Point(1,0))
        self.assertEqual(len(p1), 2) # Returns original
        self.assertEqual(len(p2), 0)

    def test_vertical_split(self):
        # Line x = 1
        lp1 = Point(1, -1)
        lp2 = Point(1, 3)
        p1, p2 = split_convex_polygon(self.square, lp1, lp2)
        
        self.assertEqual(len(p1), 4)
        self.assertEqual(len(p2), 4)
        self.assertIn(Point(1, 2), p1)
        self.assertIn(Point(1, 0), p1)

if __name__ == '__main__':
    unittest.main()
